const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const db = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const channelRoutes = require("./routes/channels.routes");
const mensajesRoutes = require("./routes/mensajes.routes");
const dispositivosRoutes = require("./routes/dispositivos.routes");
const historialRoutes = require("./routes/historial.routes");
const { inicializarFirebase, notificarCanalOffline, notificarLlamadaPersonal } = require("./config/firebase");

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT"]
    },
    maxHttpBufferSize: 20 * 1024 * 1024
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/mensajes", mensajesRoutes);
app.use("/api/dispositivos", dispositivosRoutes);
app.use("/api/historial", historialRoutes);

inicializarFirebase();

const usuariosPorCanal = {};
const estadoPorCanal = {};
const timersPTT = {};

const PTT_MAX_MS = 120000; // 2 minutos máximo por transmisión
const PTT_WARNING_MS = 90000; // aviso a los 90 segundos
const HEARTBEAT_MAX_MS = 45000; // si pasan 45s sin heartbeat, se limpia

// --- Seguridad del socket ---
// Antes el servidor creía la "prioridad" y el "usuario_id" que mandaba la
// app, así que cualquiera podía decir "soy admin (100)" y silenciar o
// sacar gente. Ahora se leen del token (JWT) que dio el login. Si no hay
// token o ya venció, se conecta igual (para no romper nada) pero como
// usuario normal (prioridad 10, sin poderes de supervisor).
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    socket.data.tokenValido = false;

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.data.tokenValido = true;
            socket.data.usuarioIdToken = Number(decoded.id || 0);
            socket.data.prioridadToken = Number(decoded.prioridad || 10);
        } catch (error) {
            console.warn("Socket con token inválido o vencido:", error.message);
        }
    }

    next();
});

function prioridadReal(socket) {
    return socket.data.tokenValido ? socket.data.prioridadToken : 10;
}

function usuarioIdReal(socket, data = {}) {
    return socket.data.tokenValido ? socket.data.usuarioIdToken : Number(data.usuario_id || 0);
}

// Cierra en la bitácora la transmisión abierta de un socket (si tiene una).
function cerrarSesionVoz(sock, inicioMs) {
    if (!sock || !sock.data.sesionVozId) return;
    const duracionSeg = inicioMs ? Math.round((Date.now() - inicioMs) / 1000) : null;
    db.query(
        `UPDATE sesiones_voz SET fin = NOW(), duracion_segundos = ? WHERE id = ?`,
        [duracionSeg, sock.data.sesionVozId]
    ).catch(err => console.error("Error al cerrar sesión de voz:", err));
    sock.data.sesionVozId = null;
}

function getSala(canalId) {
    return "canal_" + String(canalId || "1");
}

function limpiarTimerPTT(canalId) {
    if (timersPTT[canalId]) {
        if (timersPTT[canalId].warning) clearTimeout(timersPTT[canalId].warning);
        if (timersPTT[canalId].maximo) clearTimeout(timersPTT[canalId].maximo);
        delete timersPTT[canalId];
    }
}

function programarTimeoutPTT(canalId, socket, usuario) {
    limpiarTimerPTT(canalId);

    timersPTT[canalId] = {
        warning: setTimeout(() => {
            socket.emit("ptt_warning", {
                canal_id: canalId,
                mensaje: "Tiempo máximo de transmisión próximo a alcanzarse"
            });
        }, PTT_WARNING_MS),

        maximo: setTimeout(() => {
            const estado = estadoPorCanal[canalId];

            if (!estado || estado.socket_id !== socket.id) return;

            console.log("PTT liberado por timeout:", canalId, usuario);

            cerrarSesionVoz(socket, estado.inicio);

            estadoPorCanal[canalId] = {
                ocupado: false,
                usuario: null,
                socket_id: null,
                inicio: null,
                prioridad: 0
            };

            if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
                usuariosPorCanal[canalId][socket.id].hablando = false;
            }

            io.to(getSala(canalId)).emit("canal_ocupado", {
                canal_id: canalId,
                ocupado: false,
                usuario: null,
                socket_id: null,
                liberado_por_timeout: true
            });

            io.to(getSala(canalId)).emit("ptt_estado", {
                canal_id: canalId,
                mensaje: "Canal liberado automáticamente por tiempo máximo de transmisión.",
                usuario,
                hablando: false,
                socket_id: socket.id,
                liberado_por_timeout: true
            });

            limpiarTimerPTT(canalId);
            emitirUsuariosCanal(canalId);

        }, PTT_MAX_MS)
    };
}

function liberarCanalPorSocket(socket, canalId, motivo = "liberación automática") {
    const estado = estadoPorCanal[canalId];

    if (!estado || estado.socket_id !== socket.id) return false;

    const usuario = estado.usuario || socket.data.usuario || "Usuario";

    // Cierra el registro de bitácora que se abrió en ptt_inicio, con la
    // duración real de la transmisión.
    cerrarSesionVoz(socket, estado.inicio);

    estadoPorCanal[canalId] = {
        ocupado: false,
        usuario: null,
        socket_id: null,
        inicio: null,
        prioridad: 0
    };

    limpiarTimerPTT(canalId);

    if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
        usuariosPorCanal[canalId][socket.id].hablando = false;
    }

    io.to(getSala(canalId)).emit("canal_ocupado", {
        canal_id: canalId,
        ocupado: false,
        usuario: null,
        socket_id: null,
        liberado_por: motivo
    });

    io.to(getSala(canalId)).emit("ptt_estado", {
        canal_id: canalId,
        mensaje: usuario + " dejó de hablar. (" + motivo + ")",
        usuario,
        hablando: false,
        socket_id: socket.id,
        liberado_por: motivo
    });

    emitirUsuariosCanal(canalId);
    return true;
}

function obtenerListaUsuarios(canalId) {
    const canal = usuariosPorCanal[canalId] || {};
    return Object.values(canal).map((u) => ({
        socket_id: u.socket_id,
        usuario: u.usuario,
        canal_id: u.canal_id,
        hablando: !!u.hablando,
        conectado_en: u.conectado_en,
        last_heartbeat: u.last_heartbeat || null,
        prioridad: u.prioridad || 0,
        silenciado: !!u.silenciado
    }));
}

function emitirUsuariosCanal(canalId) {
    const estado = estadoPorCanal[canalId] || { ocupado: false, usuario: null, socket_id: null, inicio: null, prioridad: 0 };

    io.to(getSala(canalId)).emit("usuarios_canal", {
        canal_id: canalId,
        usuarios: obtenerListaUsuarios(canalId),
        ocupado: !!estado.ocupado,
        usuario_hablando: estado.usuario || null,
        socket_id_hablando: estado.socket_id || null
    });
}

function limpiarHablandoSiAplica(socket, canalId) {
    liberarCanalPorSocket(socket, canalId, "usuario desconectado");
}

function quitarUsuarioDeCanales(socket) {
    const canalId = socket.data.canalId;
    if (!canalId) return;

    limpiarHablandoSiAplica(socket, canalId);

    if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
        const usuario = usuariosPorCanal[canalId][socket.id].usuario || "Usuario";

        delete usuariosPorCanal[canalId][socket.id];

        if (Object.keys(usuariosPorCanal[canalId]).length === 0) {
            delete usuariosPorCanal[canalId];
            delete estadoPorCanal[canalId];
            limpiarTimerPTT(canalId);
        }

        socket.to(getSala(canalId)).emit("mensaje_canal", {
            mensaje: usuario + " salió del canal " + canalId
        });

        emitirUsuariosCanal(canalId);
    }

    socket.leave(getSala(canalId));
    socket.data.canalId = null;
}

app.get("/", async (req, res) => {
    let mysqlStatus = "OFFLINE";

    try {
        const connection = await db.getConnection();
        await connection.ping();
        connection.release();
        mysqlStatus = "ONLINE";
    } catch (error) {
        console.log("Error MySQL:", error.message);
    }

    res.json({
        app: "RadiApp Backend",
        status: "ONLINE",
        mysql: mysqlStatus,
        socket: "READY",
        version: "1.0.5",
        features: [
            "usuarios_online_por_canal",
            "bloqueo_ptt_en_servidor",
            "estado_hablando_sin_interrupciones",
            "timeout_automatico_ptt",
            "heartbeat_socket",
            "liberacion_automatica_canal",
            "prioridad_supervisor_activa"
        ]
    });
});

io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    // Monitorear un canal significa "recibir avisos de este canal" sin
    // volverte el canal activo para hablar — así puedes vigilar varios a la
    // vez. No toca estadoPorCanal ni usuariosPorCanal, solo te mete al
    // room de Socket.IO para que te lleguen los eventos.
    // --- Controles de administrador: solo supervisores (prioridad >= 50) o
    // admins (100) pueden usarlos. Se confía en la prioridad que ya trae el
    // socket desde que entró al canal (misma regla que ya usa el PTT para
    // decidir quién puede interrumpir a quién). ---
    function esAdminOSupervisor(socket) {
        return Number(socket.data.prioridad || 0) >= 50;
    }

    socket.on("silenciar_usuario", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const targetId = data.target_socket_id;
        if (!esAdminOSupervisor(socket) || !targetId) return;

        const entrada = usuariosPorCanal[canalId]?.[targetId];
        if (!entrada) return;
        entrada.silenciado = true;

        // Si justo estaba hablando, se le corta de una vez.
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            liberarCanalPorSocket(targetSocket, canalId, "silenciado por un administrador");
            targetSocket.emit("silenciado", { canal_id: canalId, silenciado: true });
        }
        emitirUsuariosCanal(canalId);
    });

    socket.on("reactivar_usuario", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const targetId = data.target_socket_id;
        if (!esAdminOSupervisor(socket) || !targetId) return;

        const entrada = usuariosPorCanal[canalId]?.[targetId];
        if (!entrada) return;
        entrada.silenciado = false;

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) targetSocket.emit("silenciado", { canal_id: canalId, silenciado: false });
        emitirUsuariosCanal(canalId);
    });

    socket.on("quitar_usuario", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const targetId = data.target_socket_id;
        if (!esAdminOSupervisor(socket) || !targetId) return;

        const targetSocket = io.sockets.sockets.get(targetId);
        if (!targetSocket) return;

        liberarCanalPorSocket(targetSocket, canalId, "expulsado por un administrador");
        targetSocket.leave(getSala(canalId));
        delete usuariosPorCanal[canalId]?.[targetId];
        targetSocket.emit("expulsado_del_canal", { canal_id: canalId });
        emitirUsuariosCanal(canalId);
    });

    // Llamada personal directa a alguien del canal: le vibra el celular y le
    // suena una alerta, aunque no esté viendo la pantalla — útil si está en
    // un lugar con ruido y no escuchó el audio normal. A diferencia de
    // alerta_canal (que es para todos), esta es solo para una persona.
    socket.on("llamar_usuario", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const targetId = data.target_socket_id;
        const usuario = data.usuario || socket.data.usuario || "Alguien";
        console.log(`[llamada] de "${usuario}" hacia target_socket_id=${targetId}`);
        if (!targetId) {
            console.warn("[llamada] la app no mandó target_socket_id — no hay a quién llamar");
            return;
        }

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.emit("llamada_personal", { canal_id: canalId, de: usuario });
            console.log(`[llamada] evento llamada_personal enviado al socket ${targetId}`);
        } else {
            console.warn(`[llamada] no encontré un socket conectado con id ${targetId}`);
        }

        // Por si no tiene la app abierta ahorita, también le mandamos push.
        const entrada = usuariosPorCanal[canalId]?.[targetId];
        if (entrada?.usuario_id) {
            notificarLlamadaPersonal(entrada.usuario_id, usuario);
        }
    });

    socket.on("monitorear_canal", (data = {}) => {
        const canalId = String(data.canal_id || "1");
        socket.join(getSala(canalId));
        if (!socket.data.canalesMonitoreados) socket.data.canalesMonitoreados = new Set();
        socket.data.canalesMonitoreados.add(canalId);

        // Le manda el estado actual de ese canal de una vez, para que la
        // app no tenga que esperar a que alguien hable para saber si ya
        // está ocupado.
        const estado = estadoPorCanal[canalId] || { ocupado: false, usuario: null, socket_id: null };
        socket.emit("canal_ocupado", {
            canal_id: canalId,
            ocupado: !!estado.ocupado,
            usuario: estado.usuario,
            socket_id: estado.socket_id
        });
    });

    socket.on("dejar_monitoreo", (data = {}) => {
        const canalId = String(data.canal_id || "1");
        socket.leave(getSala(canalId));
        if (socket.data.canalesMonitoreados) socket.data.canalesMonitoreados.delete(canalId);
    });

    socket.on("entrar_canal", (data = {}) => {
        const canalId = String(data.canal_id || "1");
        const usuario = data.usuario || "Usuario";
        const usuarioId = usuarioIdReal(socket, data);

        quitarUsuarioDeCanales(socket);

        socket.join(getSala(canalId));
        socket.data.canalId = canalId;
        socket.data.usuario = usuario;
        socket.data.usuarioId = usuarioId;

        if (!usuariosPorCanal[canalId]) usuariosPorCanal[canalId] = {};
        if (!estadoPorCanal[canalId]) estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null, inicio: null, prioridad: 0 };

        const prioridad = prioridadReal(socket);
        socket.data.prioridad = prioridad;

        usuariosPorCanal[canalId][socket.id] = {
            socket_id: socket.id,
            usuario,
            usuario_id: usuarioId,
            canal_id: canalId,
            hablando: false,
            conectado_en: new Date().toISOString(),
            last_heartbeat: Date.now(),
            prioridad
        };

        socket.to(getSala(canalId)).emit("usuario_entro", {
            socket_id: socket.id,
            usuario,
            canal_id: canalId
        });

        io.to(getSala(canalId)).emit("mensaje_canal", {
            mensaje: usuario + " entró al canal " + canalId
        });

        const estado = estadoPorCanal[canalId];
        socket.emit("canal_ocupado", {
            canal_id: canalId,
            ocupado: !!estado.ocupado,
            usuario: estado.usuario,
            socket_id: estado.socket_id
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("ptt_inicio", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";

        if (usuariosPorCanal[canalId]?.[socket.id]?.silenciado) {
            socket.emit("ptt_denegado", {
                ocupado: false,
                usuario: null,
                socket_id: null,
                mensaje: "Un administrador te silenció en este canal"
            });
            return;
        }

        if (!estadoPorCanal[canalId]) estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null, inicio: null, prioridad: 0 };
        const estado = estadoPorCanal[canalId];

        // Si este mismo usuario ya tiene el canal (la app mandó ptt_inicio dos
        // veces), solo se renueva el tiempo — antes esto creaba registros
        // duplicados en la bitácora que se quedaban sin hora de fin.
        if (estado.ocupado && estado.socket_id === socket.id) {
            programarTimeoutPTT(canalId, socket, estado.usuario || usuario);
            return;
        }

        const prioridadSolicitante = Number(socket.data.prioridad || prioridadReal(socket));
        const prioridadActual = Number(estado.prioridad || 0);

        if (estado.ocupado && estado.socket_id !== socket.id) {
            if (prioridadSolicitante > prioridadActual) {
                const socketAnterior = io.sockets.sockets.get(estado.socket_id);

                // A quien le quitaron el canal también se le cierra su
                // registro en la bitácora.
                cerrarSesionVoz(socketAnterior, estado.inicio);

                if (socketAnterior) {
                    socketAnterior.emit("ptt_interrumpido", {
                        canal_id: canalId,
                        canal_id: canalId,
                        usuario: estado.usuario,
                        nuevo_usuario: usuario,
                        motivo: "prioridad_superior"
                    });
                }

                if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][estado.socket_id]) {
                    usuariosPorCanal[canalId][estado.socket_id].hablando = false;
                }

                limpiarTimerPTT(canalId);

                io.to(getSala(canalId)).emit("ptt_estado", {
                    canal_id: canalId,
                    mensaje: usuario + " tomó prioridad del canal.",
                    usuario,
                    hablando: true,
                    socket_id: socket.id,
                    prioridad: prioridadSolicitante,
                    prioridad_tomada: true
                });

            } else {
                socket.emit("ptt_denegado", {
                    canal_id: canalId,
                    ocupado: true,
                    usuario: estado.usuario,
                    socket_id: estado.socket_id,
                    mensaje: "Canal ocupado por " + estado.usuario
                });
                emitirUsuariosCanal(canalId);
                return;
            }
        }

        estadoPorCanal[canalId] = {
            ocupado: true,
            usuario,
            socket_id: socket.id,
            inicio: Date.now(),
            prioridad: prioridadSolicitante
        };

        // Bitácora: registra el inicio de esta transmisión (se completa con
        // fin/duración cuando llegue ptt_fin).
        const usuarioIdSesion = Number(socket.data.usuarioId || usuarioIdReal(socket, data));
        console.log(`[bitácora] ptt_inicio de "${usuario}" — usuario_id recibido: ${usuarioIdSesion}`);
        if (usuarioIdSesion > 0) {
            db.query(
                `INSERT INTO sesiones_voz (canal_id, usuario_id, inicio) VALUES (?, ?, NOW())`,
                [canalId, usuarioIdSesion]
            ).then(([resultado]) => {
                socket.data.sesionVozId = resultado.insertId;
                console.log(`[bitácora] sesión de voz creada, id ${resultado.insertId}`);
            }).catch(err => console.error("[bitácora] Error al registrar sesión de voz:", err));
        } else {
            console.warn(`[bitácora] NO se guardó — usuario_id llegó en 0 o vacío desde la app`);
        }

        programarTimeoutPTT(canalId, socket, usuario);

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].hablando = true;
            usuariosPorCanal[canalId][socket.id].usuario = usuario;
            usuariosPorCanal[canalId][socket.id].last_heartbeat = Date.now();
        }

        io.to(getSala(canalId)).emit("canal_ocupado", {
            canal_id: canalId,
            ocupado: true,
            usuario,
            socket_id: socket.id,
            prioridad: prioridadSolicitante
        });

        io.to(getSala(canalId)).emit("ptt_estado", {
            canal_id: canalId,
            mensaje: usuario + " está hablando...",
            usuario,
            hablando: true,
            socket_id: socket.id
        });

        emitirUsuariosCanal(canalId);

        // Avisa por notificación push a quien sea miembro del canal pero no
        // esté conectado ahorita (los que ya están conectados lo están
        // escuchando en vivo, no hace falta molestarlos con un push).
        const usuarioIdQueHabla = usuarioIdSesion;
        const idsConectados = Object.values(usuariosPorCanal[canalId] || {})
            .map(u => u.usuario_id)
            .filter(Boolean);
        notificarCanalOffline(canalId, usuario, usuarioIdQueHabla, idsConectados);
    });

    socket.on("ptt_fin", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";
        const estado = estadoPorCanal[canalId];

        if (estado && estado.ocupado && estado.socket_id !== socket.id) {
            socket.emit("ptt_denegado", {
                canal_id: canalId,
                ocupado: true,
                usuario: estado.usuario,
                socket_id: estado.socket_id,
                mensaje: "No puedes liberar un canal ocupado por otro usuario"
            });
            return;
        }

        liberarCanalPorSocket(socket, canalId, "PTT liberado");
    });

    socket.on("webrtc_signal", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const target = data.target || data.to || null;

        const signal = {
            from: socket.id,
            target,
            type: data.type,
            payload: data.payload,
            usuario: data.usuario || socket.data.usuario || "Usuario"
        };

        if (target && io.sockets.sockets.get(target)) {
            io.to(target).emit("webrtc_signal", signal);
            return;
        }

        socket.to(getSala(canalId)).emit("webrtc_signal", signal);
    });

    socket.on("alerta_canal", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";
        console.log(`[alerta] "${usuario}" mandó alerta al canal ${canalId}`);

        io.to(getSala(canalId)).emit("alerta_canal", {
            canal_id: canalId,
            usuario,
            socket_id: socket.id,
            timestamp: Date.now()
        });
    });

    socket.on("audio_completo", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");

        socket.emit("audio_ack", {
            mensaje: "Servidor recibió audio de " + data.usuario,
            size: data.audio ? data.audio.length : 0
        });

        socket.to(getSala(canalId)).emit("audio_completo", {
            audio: data.audio,
            usuario: data.usuario
        });
    });

    socket.on("heartbeat", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].last_heartbeat = Date.now();
        }

        socket.emit("heartbeat_ack", {
            ok: true,
            server_time: Date.now(),
            canal_id: canalId
        });
    });

    socket.on("ptt_keepalive", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const estado = estadoPorCanal[canalId];

        if (!estado || estado.socket_id !== socket.id) return;

        programarTimeoutPTT(canalId, socket, estado.usuario || socket.data.usuario || "Usuario");
    });

    socket.on("salir_canal", () => {
        quitarUsuarioDeCanales(socket);
    });

    socket.on("disconnect", () => {
        console.log("Usuario desconectado:", socket.id);
        quitarUsuarioDeCanales(socket);
    });
});


setInterval(() => {
    const ahora = Date.now();

    Object.keys(usuariosPorCanal).forEach((canalId) => {
        const usuarios = usuariosPorCanal[canalId] || {};

        Object.keys(usuarios).forEach((socketId) => {
            const usuario = usuarios[socketId];

            if (!usuario.last_heartbeat) return;

            const socketObj = io.sockets.sockets.get(socketId);

            if (!socketObj || (ahora - usuario.last_heartbeat) > HEARTBEAT_MAX_MS) {
                console.log("Usuario limpiado por heartbeat vencido:", usuario.usuario, canalId);

                if (socketObj) {
                    quitarUsuarioDeCanales(socketObj);
                } else {
                    if (estadoPorCanal[canalId] && estadoPorCanal[canalId].socket_id === socketId) {
                        estadoPorCanal[canalId] = {
                            ocupado: false,
                            usuario: null,
                            socket_id: null,
                            inicio: null,
                            prioridad: 0
                        };

                        limpiarTimerPTT(canalId);

                        io.to(getSala(canalId)).emit("canal_ocupado", {
                            canal_id: canalId,
                            ocupado: false,
                            usuario: null,
                            socket_id: null,
                            liberado_por: "heartbeat vencido"
                        });

                        io.to(getSala(canalId)).emit("ptt_estado", {
                            canal_id: canalId,
                            mensaje: "Canal liberado automáticamente por pérdida de conexión.",
                            hablando: false,
                            liberado_por: "heartbeat vencido"
                        });
                    }

                    delete usuariosPorCanal[canalId][socketId];

                    if (Object.keys(usuariosPorCanal[canalId]).length === 0) {
                        delete usuariosPorCanal[canalId];
                        delete estadoPorCanal[canalId];
                        limpiarTimerPTT(canalId);
                    } else {
                        emitirUsuariosCanal(canalId);
                    }
                }
            }
        });
    });
}, 15000);

const PORT = process.env.PORT || 3000;

// Los mensajes de voz grabados no se guardan para siempre: se borran solos
// después de 72 horas, y además se limita a 100 mensajes por canal como
// tope de seguridad extra (por si un canal se usa muchísimo).
const HORAS_RETENCION_MENSAJES = 72;
const MAX_MENSAJES_POR_CANAL = 100;

async function limpiarMensajesVoz() {
    try {
        const [porAntiguedad] = await db.query(
            `DELETE FROM mensajes_voz WHERE creado_en < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
            [HORAS_RETENCION_MENSAJES]
        );
        if (porAntiguedad.affectedRows > 0) {
            console.log(`Limpieza: ${porAntiguedad.affectedRows} mensajes de voz vencidos borrados`);
        }

        const [canales] = await db.query(`SELECT DISTINCT canal_id FROM mensajes_voz`);
        for (const { canal_id } of canales) {
            await db.query(
                `DELETE FROM mensajes_voz
                 WHERE canal_id = ?
                 AND id NOT IN (
                     SELECT id FROM (
                         SELECT id FROM mensajes_voz
                         WHERE canal_id = ?
                         ORDER BY creado_en DESC
                         LIMIT ?
                     ) AS conservar
                 )`,
                [canal_id, canal_id, MAX_MENSAJES_POR_CANAL]
            );
        }
    } catch (error) {
        console.error("Error en limpieza de mensajes de voz:", error);
    }
}

// Corre una vez al iniciar el servidor y luego cada hora.
limpiarMensajesVoz();
setInterval(limpiarMensajesVoz, 60 * 60 * 1000);

server.listen(PORT, () => {
    console.log(`Servidor RadiApp activo en puerto ${PORT}`);
});
