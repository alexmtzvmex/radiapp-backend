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
    io.to("canal_" + canalId).emit("usuarios_canal", {
        canal_id: canalId,
        usuarios: obtenerListaUsuarios(canalId)
    });
}

function quitarUsuarioDeCanales(socket) {
    const canalId = socket.data.canalId;

    if (!canalId) return;

    if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
        const usuario = usuariosPorCanal[canalId][socket.id].usuario || "Usuario";

        delete usuariosPorCanal[canalId][socket.id];

        if (Object.keys(usuariosPorCanal[canalId]).length === 0) {
            delete usuariosPorCanal[canalId];
        }

        socket.to("canal_" + canalId).emit("mensaje_canal", {
            mensaje: usuario + " salió del canal " + canalId
        });

        emitirUsuariosCanal(canalId);
    }
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
        version: "1.0.4",
        features: [
            "usuarios_online_por_canal",
            "estado_hablando",
            "presencia_socket_io"
        ]
    });
});

io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    socket.on("entrar_canal", (data) => {
        const canalId = String(data.canal_id || "1");
        const usuario = data.usuario || "Usuario";

        quitarUsuarioDeCanales(socket);

        socket.join("canal_" + canalId);
        socket.data.canalId = canalId;
        socket.data.usuario = usuario;

        if (!usuariosPorCanal[canalId]) {
            usuariosPorCanal[canalId] = {};
        }

        usuariosPorCanal[canalId][socket.id] = {
            socket_id: socket.id,
            usuario,
            canal_id: canalId,
            hablando: false,
            conectado_en: new Date().toISOString()
        };

        socket.to("canal_" + canalId).emit("usuario_entro", {
            socket_id: socket.id,
            usuario,
            canal_id: canalId
        });

        io.to("canal_" + canalId).emit("mensaje_canal", {
            mensaje: usuario + " entró al canal " + canalId
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("ptt_inicio", (data) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].hablando = true;
            usuariosPorCanal[canalId][socket.id].usuario = usuario;
        }

        socket.to("canal_" + canalId).emit("canal_ocupado", {
            ocupado: true,
            usuario
        });

        io.to("canal_" + canalId).emit("ptt_estado", {
            mensaje: usuario + " está hablando...",
            usuario,
            hablando: true
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("ptt_fin", (data) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");
        const usuario = data.usuario || socket.data.usuario || "Usuario";

        if (usuariosPorCanal[canalId] && usuariosPorCanal[canalId][socket.id]) {
            usuariosPorCanal[canalId][socket.id].hablando = false;
            usuariosPorCanal[canalId][socket.id].usuario = usuario;
        }

        socket.to("canal_" + canalId).emit("canal_ocupado", {
            ocupado: false,
            usuario
        });

        io.to("canal_" + canalId).emit("ptt_estado", {
            mensaje: usuario + " dejó de hablar.",
            usuario,
            hablando: false
        });

        emitirUsuariosCanal(canalId);
    });

    socket.on("webrtc_signal", (data) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");

        socket.to("canal_" + canalId).emit("webrtc_signal", {
            from: socket.id,
            type: data.type,
            payload: data.payload,
            usuario: data.usuario || socket.data.usuario || "Usuario"
        });
    });

    socket.on("audio_completo", (data) => {
        const canalId = String(data.canal_id || socket.data.canalId || "1");

        socket.emit("audio_ack", {
            mensaje: "Servidor recibió audio de " + data.usuario,
            size: data.audio ? data.audio.length : 0
        });

        socket.to("canal_" + canalId).emit("audio_completo", {
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
