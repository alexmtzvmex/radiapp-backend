const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const router = express.Router();
const db = require("../config/db");

router.post("/register", async (req, res) => {
    try {
        const { nombre_completo, telefono, correo, password } = req.body;

        if (!nombre_completo || !correo || !password) {
            return res.status(400).json({ error: "Faltan datos obligatorios" });
        }

        const [existing] = await db.query(
            "SELECT id FROM usuarios WHERE correo = ?",
            [correo]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: "El correo ya está registrado" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            `INSERT INTO usuarios
            (nombre_completo, telefono, correo, password_hash, estatus)
            VALUES (?, ?, ?, ?, 'pendiente')`,
            [nombre_completo, telefono, correo, passwordHash]
        );

        await db.query(
            `INSERT INTO solicitudes_registro
            (usuario_id, nombre_completo, telefono, correo, estatus)
            VALUES (?, ?, ?, ?, 'pendiente')`,
            [result.insertId, nombre_completo, telefono, correo]
        );

        res.json({
            success: true,
            message: "Solicitud enviada correctamente. Espera autorización del administrador."
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { correo, password } = req.body;

        if (!correo || !password) {
            return res.status(400).json({ error: "Correo y contraseña son obligatorios" });
        }

        const [users] = await db.query(
            "SELECT * FROM usuarios WHERE correo = ? LIMIT 1",
            [correo]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: "Credenciales incorrectas" });
        }

        const user = users[0];

        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: "Credenciales incorrectas" });
        }

        if (user.estatus !== "activo") {
            return res.status(403).json({
                error: "Tu usuario aún no está autorizado",
                estatus: user.estatus
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                correo: user.correo,
                rol: user.rol
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        await db.query(
            "UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?",
            [user.id]
        );

        res.json({
            success: true,
            message: "Login correcto",
            token,
            user: {
                id: user.id,
                nombre_completo: user.nombre_completo,
                telefono: user.telefono,
                correo: user.correo,
                rol: user.rol,
                estatus: user.estatus
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;
