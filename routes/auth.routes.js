const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/db");

router.post("/register", async (req, res) => {
    try {
        const { nombre_completo, correo, password } = req.body;

        if (!nombre_completo || !correo || !password) {
            return res.status(400).json({
                success: false,
                error: "Faltan datos obligatorios"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: "La contraseña debe tener mínimo 6 caracteres"
            });
        }

        const correoNormalizado = correo.trim().toLowerCase();

        const [existeUsuario] = await db.query(
            "SELECT id FROM usuarios WHERE correo = ? LIMIT 1",
            [correoNormalizado]
        );

        if (existeUsuario.length > 0) {
            return res.status(400).json({
                success: false,
                error: "Este correo ya está registrado"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await db.query(
            `INSERT INTO usuarios
            (nombre_completo, correo, password_hash, estatus, rol)
            VALUES (?, ?, ?, 'pendiente', 'usuario')`,
            [nombre_completo.trim(), correoNormalizado, passwordHash]
        );

        res.json({
            success: true,
            message: "Solicitud enviada correctamente. Espera autorización del administrador."
        });

    } catch (error) {
        console.error("Error register:", error);

        res.status(500).json({
            success: false,
            error: "Error del servidor"
        });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { correo, password } = req.body;

        if (!correo || !password) {
            return res.status(400).json({
                success: false,
                error: "Correo y contraseña requeridos"
            });
        }

        const correoNormalizado = correo.trim().toLowerCase();

        const [usuarios] = await db.query(
            "SELECT * FROM usuarios WHERE correo = ? LIMIT 1",
            [correoNormalizado]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                success: false,
                error: "Usuario no encontrado"
            });
        }

        const usuario = usuarios[0];

        if (usuario.estatus !== "activo") {
            return res.status(403).json({
                success: false,
                error: "Tu cuenta aún no ha sido autorizada por el administrador"
            });
        }

        const passwordCorrecto = await bcrypt.compare(
            password,
            usuario.password_hash
        );

        if (!passwordCorrecto) {
            return res.status(401).json({
                success: false,
                error: "Contraseña incorrecta"
            });
        }

        const token = jwt.sign(
            {
                id: usuario.id,
                correo: usuario.correo,
                rol: usuario.rol || "usuario",
                prioridad:
                    usuario.rol === "admin"
                        ? 100
                        : usuario.rol === "supervisor"
                            ? 50
                            : 10
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            success: true,
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre_completo,
                correo: usuario.correo,
                rol: usuario.rol || "usuario",
                estatus: usuario.estatus
            }
        });

    } catch (error) {
        console.error("Error login:", error);

        res.status(500).json({
            success: false,
            error: "Error del servidor"
        });
    }
});

module.exports = router;
