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
    }
});

app.use(cors());
app.use(express.json());

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
        version: "1.0.0"
    });
});

io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    socket.on("entrar_canal", (data) => {
        const canalId = data.canal_id;
        const usuario = data.usuario || "Usuario";

        socket.join("canal_" + canalId);

        io.to("canal_" + canalId).emit("mensaje_canal", {
            tipo: "sistema",
            mensaje: usuario + " entró al canal " + canalId
        });
    });

    socket.on("ptt_inicio", (data) => {
        const canalId = data.canal_id;
        const usuario = data.usuario || "Usuario";

        io.to("canal_" + canalId).emit("ptt_estado", {
            hablando: true,
            usuario: usuario,
            mensaje: usuario + " está hablando..."
        });
    });

    socket.on("ptt_fin", (data) => {
        const canalId = data.canal_id;
        const usuario = data.usuario || "Usuario";

        io.to("canal_" + canalId).emit("ptt_estado", {
            hablando: false,
            usuario: usuario,
            mensaje: usuario + " dejó de hablar."
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
