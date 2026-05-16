const express = require("express");
const bcrypt = require("bcryptjs");

const router = express.Router();

const db = require("../config/db");

router.post("/register", async (req, res) => {

    try {

        const {
            nombre_completo,
            telefono,
            correo,
            password
        } = req.body;

        if (!nombre_completo || !correo || !password) {

            return res.status(400).json({
                error: "Faltan datos obligatorios"
            });

        }

        const [existing] = await db.query(
            "SELECT id FROM usuarios WHERE correo = ?",
            [correo]
        );

        if (existing.length > 0) {

            return res.status(400).json({
                error: "El correo ya está registrado"
            });

        }

        const passwordHash = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            `INSERT INTO usuarios
            (nombre_completo, telefono, correo, password_hash, estatus)
            VALUES (?, ?, ?, ?, 'pendiente')`,
            [
                nombre_completo,
                telefono,
                correo,
                passwordHash
            ]
        );

        await db.query(
            `INSERT INTO solicitudes_registro
            (usuario_id, nombre_completo, telefono, correo, estatus)
            VALUES (?, ?, ?, ?, 'pendiente')`,
            [
                result.insertId,
                nombre_completo,
                telefono,
                correo
            ]
        );

        res.json({
            success: true,
            message: "Solicitud enviada correctamente"
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error interno del servidor"
        });

    }

});

module.exports = router;
