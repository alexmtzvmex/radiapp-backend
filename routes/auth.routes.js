const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/db");

function normalizarCorreo(correo) {
    return String(correo || "").trim().toLowerCase();
}

router.post("/register", async (req, res) => {
    try {
        const nombre_completo = String(req.body.nombre_completo || "").trim();
        const correo = normalizarCorreo(req.body.correo);
        const password = String(req.body.password || "");

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

        const [existe] = await db.query(
            "SELECT id, estatus FROM usuarios WHERE correo = ? LIMIT 1",
            [correo]
        );

        if (existe.length > 0) {
            const estatus = existe[0].estatus;

            if (estatus === "pendiente") {
                return res.status(409).json({
                    success: false,
                    error: "Este correo ya tiene una solicitud pendiente de autorización"
                });
            }

            return res.status(409).json({
                success: false,
                error: "Este correo ya está registrado"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await db.query(
            `INSERT INTO usuarios
                (nombre_completo, correo, password_hash, estatus, fecha_registro)
             VALUES (?, ?, ?, 'pendiente', NOW())`,
            [nombre_completo, correo, passwordHash]
        );

        return res.status(201).json({
            success: true,
            message: "Solicitud enviada correctamente. Espera autorización del administrador."
        });

    } catch (error) {
        console.error("Error en /api/auth/register:", error);

        return res.status(500).json({
            success: false,
            error: "Error del servidor al registrar usuario"
        });
    }
});

router.post("/login", async (req, res) => {
    try {
        const correo = normalizarCorreo(req.body.correo);
        const password = String(req.body.password || "");

        if (!correo || !password) {
            return res.status(400).json({
                success: false,
                error: "Correo y contraseña requeridos"
            });
        }

        const [usuarios] = await db.query(
            `SELECT id, nombre_completo, correo, password_hash, estatus
             FROM usuarios
             WHERE correo = ?
             LIMIT 1`,
            [correo]
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

        const passwordCorrecto = await bcrypt.compare(password, usuario.password_hash);

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
                estatus: usuario.estatus
            },
            process.env.JWT_SECRET || "RadiAppSecret2026",
            { expiresIn: "7d" }
        );

        return res.json({
            success: true,
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre_completo,
                correo: usuario.correo,
                estatus: usuario.estatus
            }
        });

    } catch (error) {
        console.error("Error en /api/auth/login:", error);

        return res.status(500).json({
            success: false,
            error: "Error del servidor al iniciar sesión"
        });
    }
});

module.exports = router;
