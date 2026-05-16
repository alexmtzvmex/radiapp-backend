const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");

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

app.get("/", (req, res) => {
    res.json({
        app: "RadiApp Backend",
        status: "ONLINE",
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
