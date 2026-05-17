const express = require("express");
const adminRoutes = require("./routes/admin.routes");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const db = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const app = express();

const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
const authRoutes = require("./routes/auth.routes");

app.use(express.json());

app.use("/api/auth", authRoutes);
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
        version: "1.0.0"
    });

});

io.on("connection", (socket) => {

    console.log("Usuario conectado:", socket.id);

    socket.on("disconnect", () => {

        console.log("Usuario desconectado:", socket.id);

    });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(`Servidor RadiApp activo en puerto ${PORT}`);

});
