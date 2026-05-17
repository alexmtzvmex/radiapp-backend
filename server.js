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
        version: "1.0.1"
    });
});

io.on("connection", (socket) => {
    
    console.log("Usuario conectado:", socket.id);

    socket.on("entrar_canal", (data) => {
        const canalId = data.canal_id || "1";
        const usuario = data.usuario || "Usuario";

        socket.join("canal_" + canalId);
        socket.data.canalId = canalId;
        socket.data.usuario = usuario;

        io.to("canal_" + canalId).emit("mensaje_canal", {
            mensaje: usuario + " entró al canal " + canalId
        });
    });

    socket.on("ptt_inicio", (data) => {
socket.on("webrtc_offer", (data) => {
    socket.to("canal_" + data.canal_id).emit("webrtc_offer", {
        offer: data.offer,
        usuario: data.usuario
    });
});

socket.on("webrtc_answer", (data) => {
    socket.to("canal_" + data.canal_id).emit("webrtc_answer", {
        answer: data.answer,
        usuario: data.usuario
    });
});

socket.on("webrtc_ice_candidate", (data) => {
    socket.to("canal_" + data.canal_id).emit("webrtc_ice_candidate", {
        candidate: data.candidate,
        usuario: data.usuario
    });
});        io.to("canal_" + data.canal_id).emit("ptt_estado", {
            mensaje: data.usuario + " está hablando..."
        });
    });

    socket.on("ptt_fin", (data) => {
        io.to("canal_" + data.canal_id).emit("ptt_estado", {
            mensaje: data.usuario + " dejó de hablar."
        });
    });

    socket.on("audio_completo", (data) => {
        const canalId = data.canal_id || socket.data.canalId || "1";

        console.log("Audio recibido:", {
            canal: canalId,
            usuario: data.usuario,
            size: data.audio ? data.audio.length : 0
        });

        socket.emit("audio_ack", {
            mensaje: "Servidor recibió audio de " + data.usuario,
            size: data.audio ? data.audio.length : 0
        });

        socket.to("canal_" + canalId).emit("audio_completo", {
            audio: data.audio,
            usuario: data.usuario
        });
    });

    socket.on("disconnect", () => {
        console.log("Usuario desconectado:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor RadiApp activo en puerto ${PORT}`);
});
