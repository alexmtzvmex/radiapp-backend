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

function getSala(canalId) {
    return "canal_" + String(canalId || "1");
}

function obtenerListaUsuarios(canalId) {
    const canal = usuariosPorCanal[canalId] || {};
    return Object.values(canal).map((u) => ({
        socket_id: u.socket_id,
        usuario: u.usuario,
        canal_id: u.canal_id,
        hablando: !!u.hablando,
        conectado_en: u.conectado_en
    }));
}

function emitirUsuariosCanal(canalId) {
    const estado = estadoPorCanal[canalId] || { ocupado: false, usuario: null, socket_id: null };

    io.to(getSala(canalId)).emit("usuarios_canal", {
        canal_id: canalId,
        usuarios: obtenerListaUsuarios(canalId),
        ocupado: !!estado.ocupado,
        usuario_hablando: estado.usuario || null,
        socket_id_hablando: estado.socket_id || null
    });
}

function limpiarHablandoSiAplica(socket, canalId) {
    const estado = estadoPorCanal[canalId];
    if (estado && estado.socket_id === socket.id) {
        estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null };

        io.to(getSala(canalId)).emit("canal_ocupado", {
            ocupado: false,
            usuario: null,
            socket_id: null
        });
    }
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
            "estado_hablando_sin_interrupciones"
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
        if (!estadoPorCanal[canalId]) estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null };

        usuariosPorCanal[canalId][socket.id] = {
            socket_id: socket.id,
            usuario,
            canal_id: canalId,
            hablando: false,
            conectado_en: new Date().toISOString()
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

        if (!estadoPorCanal[canalId]) estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null };
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
            socket_id: socket.id
        };

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].hablando = true;
            usuariosPorCanal[canalId][socket.id].usuario = usuario;
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

        estadoPorCanal[canalId] = { ocupado: false, usuario: null, socket_id: null };

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].hablando = false;
            usuariosPorCanal[canalId][socket.id].usuario = usuario;
        }

        io.to(getSala(canalId)).emit("canal_ocupado", {
            ocupado: false,
            usuario: null,
            socket_id: null
        });

        io.to(getSala(canalId)).emit("ptt_estado", {
            mensaje: usuario + " dejó de hablar.",
            usuario,
            hablando: false,
            socket_id: socket.id
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("webrtc_signal", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");

        socket.to(getSala(canalId)).emit("webrtc_signal", {
            from: socket.id,
            type: data.type,
            payload: data.payload,
            usuario: data.usuario || socket.data.usuario || "Usuario"
        });
    });

    socket.on("alerta_canal", (data = {}) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";

        io.to(getSala(canalId)).emit("alerta_canal", {
            canal_id: canalId,
            usuario,
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

    socket.on("salir_canal", () => {
        quitarUsuarioDeCanales(socket);
    });

    socket.on("disconnect", () => {
        console.log("Usuario desconectado:", socket.id);
        quitarUsuarioDeCanales(socket);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor RadiApp activo en puerto ${PORT}`);
});
