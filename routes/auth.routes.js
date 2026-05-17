const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/db");

router.post("/register", async (req, res) => {

    try {

        const {
            nombre_completo,
            correo,
            password
        } = req.body;

        if (!nombre_completo || !correo || !password) {
            return res.status(400).json({
                error: "Faltan datos obligatorios"
            });
        }

        const [existe] = await db.query(
            "SELECT id FROM solicitudes_registro WHERE correo = ?",
            [correo]
        );

        if (existe.length > 0) {
            return res.status(400).json({
                error: "El correo ya existe"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await db.query(
            `INSERT INTO solicitudes_registro
            (nombre_completo, correo, password_hash)
            VALUES (?, ?, ?)`,
            [nombre_completo, correo, passwordHash]
        );

        res.json({
            success: true,
            message: "Solicitud enviada correctamente. Espera autorización del administrador."
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error del servidor"
        });
    }
});

router.post("/login", async (req, res) => {

    try {

        const { correo, password } = req.body;

        if (!correo || !password) {
            return res.status(400).json({
                error: "Correo y password requeridos"
            });
        }

        const [usuarios] = await db.query(
            "SELECT * FROM usuarios WHERE correo = ? LIMIT 1",
            [correo]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                error: "Usuario no encontrado"
            });
        }

        const usuario = usuarios[0];

        const passwordCorrecto = await bcrypt.compare(
            password,
            usuario.password_hash
        );

        if (!passwordCorrecto) {
            return res.status(401).json({
                error: "Password incorrecto"
            });
        }

        const token = jwt.sign(
            {
                id: usuario.id,
                correo: usuario.correo
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d"
            }
        );

        res.json({
            success: true,
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre_completo,
                correo: usuario.correo
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error del servidor"
        });
    }
});

module.exports = router;
