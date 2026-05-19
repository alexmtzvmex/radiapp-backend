const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const db = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const channelRoutes = require("./routes/channels.routes");

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

const usuariosPorCanal = {};
const estadoPorCanal = {};
const timersPTT = {};

const PTT_MAX_MS = 120000; // 2 minutos máximo por transmisión
const PTT_WARNING_MS = 90000; // aviso a los 90 segundos
const HEARTBEAT_MAX_MS = 45000; // si pasan 45s sin heartbeat, se limpia

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

            estadoPorCanal[canalId] = {
                ocupado: false,
                usuario: null,
                socket_id: null,
                inicio: null
            };

            if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
                usuariosPorCanal[canalId][socket.id].hablando = false;
            }

            io.to(getSala(canalId)).emit("canal_ocupado", {
                ocupado: false,
                usuario: null,
                socket_id: null,
                liberado_por_timeout: true
            });

            io.to(getSala(canalId)).emit("ptt_estado", {
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

    estadoPorCanal[canalId] = {
        ocupado: false,
        usuario: null,
        socket_id: null,
        inicio: null
    };

    limpiarTimerPTT(canalId);

    if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
        usuariosPorCanal[canalId][socket.id].hablando = false;
    }

    io.to(getSala(canalId)).emit("canal_ocupado", {
        ocupado: false,
        usuario: null,
        socket_id: null,
        liberado_por: motivo
    });

    io.to(getSala(canalId)).emit("ptt_estado", {
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
        prioridad: u.prioridad || 0
    }));
}

function emitirUsuariosCanal(canalId) {
    const estado = estadoPorCanal[canalId] || { ocupado: false, usuario: null, socket_id: null, inicio: null };

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
            "preparado_prioridad_supervisor"
        ]
    });
});

io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    socket.on("entrar_canal", (data = {}) => {
        const canalId = String(data.canal_id || "1");
        const usuario = data.usuario || "Usuario";

        quitarUsuarioDeCanales(socket);

        socket.join(getSala(canalId));
        socket.data.canalId = canalId;
        socket.data.usuario = usuario;

        if (!usuariosPorCanal[canalId]) usuariosPorCanal[canalId] = {};
        if (!estadoPorCanal[canalId]) estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null, inicio: null };

        usuariosPorCanal[canalId][socket.id] = {
            socket_id: socket.id,
            usuario,
            canal_id: canalId,
            hablando: false,
            conectado_en: new Date().toISOString(),
            last_heartbeat: Date.now(),
            prioridad: Number(data.prioridad || 0)
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
            ocupado: !!estado.ocupado,
            usuario: estado.usuario,
            socket_id: estado.socket_id
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("ptt_inicio", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";

        if (!estadoPorCanal[canalId]) estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null, inicio: null };
        const estado = estadoPorCanal[canalId];

        if (estado.ocupado && estado.socket_id !== socket.id) {
            socket.emit("ptt_denegado", {
                ocupado: true,
                usuario: estado.usuario,
                socket_id: estado.socket_id,
                mensaje: "Canal ocupado por " + estado.usuario
            });
            emitirUsuariosCanal(canalId);
            return;
        }

        estadoPorCanal[canalId] = {
            ocupado: true,
            usuario,
            socket_id: socket.id,
            inicio: Date.now()
        };

        programarTimeoutPTT(canalId, socket, usuario);

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].hablando = true;
            usuariosPorCanal[canalId][socket.id].usuario = usuario;
            usuariosPorCanal[canalId][socket.id].last_heartbeat = Date.now();
        }

        io.to(getSala(canalId)).emit("canal_ocupado", {
            ocupado: true,
            usuario,
            socket_id: socket.id
        });

        io.to(getSala(canalId)).emit("ptt_estado", {
            mensaje: usuario + " está hablando...",
            usuario,
            hablando: true,
            socket_id: socket.id
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("ptt_fin", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";
        const estado = estadoPorCanal[canalId];

        if (estado && estado.ocupado && estado.socket_id !== socket.id) {
            socket.emit("ptt_denegado", {
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
                            inicio: null
                        };

                        limpiarTimerPTT(canalId);

                        io.to(getSala(canalId)).emit("canal_ocupado", {
                            ocupado: false,
                            usuario: null,
                            socket_id: null,
                            liberado_por: "heartbeat vencido"
                        });

                        io.to(getSala(canalId)).emit("ptt_estado", {
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

server.listen(PORT, () => {
    console.log(`Servidor RadiApp activo en puerto ${PORT}`);
});
