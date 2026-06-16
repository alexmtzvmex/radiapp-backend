const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Resend } = require("resend");

const db = require("../config/db");


function generarCodigoRecuperacion() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

async function enviarCodigoRecuperacion(correo, nombre, codigo) {
    if (!process.env.RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY no configurado en Render");
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || "RadiApp <onboarding@resend.dev>";

    const resultado = await resend.emails.send({
        from,
        to: [correo],
        subject: "Código de recuperación - RadiApp",
        html: `
            <div style="font-family:Arial,sans-serif;background:#020817;color:#e5e7eb;padding:24px;">
                <div style="max-width:560px;margin:auto;background:#0b1729;border:1px solid #2dd4bf;border-radius:18px;padding:28px;">
                    <h2 style="color:#5CF2D6;margin-top:0;">RadiApp</h2>
                    <p>Hola${nombre ? " " + nombre : ""},</p>
                    <p>Recibimos una solicitud para recuperar tu contraseña.</p>
                    <p style="font-size:15px;color:#94a3b8;">Tu código de recuperación es:</p>
                    <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#ffffff;background:#020817;border:1px solid #334155;border-radius:14px;padding:18px;text-align:center;">
                        ${codigo}
                    </div>
                    <p style="margin-top:22px;">Este código expira en <strong>15 minutos</strong>.</p>
                    <p style="color:#94a3b8;font-size:13px;">Si tú no solicitaste este código, puedes ignorar este correo.</p>
                </div>
            </div>
        `
    });

    if (resultado.error) {
        throw new Error(resultado.error.message || "Resend no pudo enviar el correo");
    }

    return resultado;
}

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


router.post("/forgot-password", async (req, res) => {
    try {
        const { correo } = req.body;

        if (!correo) {
            return res.status(400).json({
                success: false,
                error: "Ingresa tu correo electrónico"
            });
        }

        const correoNormalizado = correo.trim().toLowerCase();

        const [usuarios] = await db.query(
            "SELECT id, nombre_completo, correo, estatus FROM usuarios WHERE correo = ? LIMIT 1",
            [correoNormalizado]
        );

        if (usuarios.length === 0) {
            return res.status(404).json({
                success: false,
                error: "No existe una cuenta registrada con ese correo"
            });
        }

        const usuario = usuarios[0];

        if (usuario.estatus === "bloqueado" || usuario.estatus === "rechazado") {
            return res.status(403).json({
                success: false,
                error: "La cuenta no está disponible. Contacta al administrador."
            });
        }

        const codigo = generarCodigoRecuperacion();

        await db.query(
            "UPDATE password_resets SET usado = 1 WHERE user_id = ? AND usado = 0",
            [usuario.id]
        );

        await db.query(
            `INSERT INTO password_resets (user_id, codigo, expira_en, usado)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE), 0)`,
            [usuario.id, codigo]
        );

        await enviarCodigoRecuperacion(
            usuario.correo,
            usuario.nombre_completo,
            codigo
        );

        res.json({
            success: true,
            message: "Código enviado. Revisa tu correo electrónico."
        });

    } catch (error) {
        console.error("Error forgot-password:", error);

        res.status(500).json({
            success: false,
            error: "No se pudo enviar el código por correo. Revisa RESEND_API_KEY y MAIL_FROM en Render."
        });
    }
});

router.post("/reset-password", async (req, res) => {
    try {
        const { correo, codigo, password } = req.body;

        if (!correo || !codigo || !password) {
            return res.status(400).json({
                success: false,
                error: "Correo, código y nueva contraseña son obligatorios"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: "La nueva contraseña debe tener mínimo 6 caracteres"
            });
        }

        const correoNormalizado = correo.trim().toLowerCase();
        const codigoNormalizado = String(codigo).trim();

        const [usuarios] = await db.query(
            "SELECT id, correo FROM usuarios WHERE correo = ? LIMIT 1",
            [correoNormalizado]
        );

        if (usuarios.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Usuario no encontrado"
            });
        }

        const usuario = usuarios[0];

        const [resets] = await db.query(
            `SELECT id
             FROM password_resets
             WHERE user_id = ?
               AND codigo = ?
               AND usado = 0
               AND expira_en >= NOW()
             ORDER BY id DESC
             LIMIT 1`,
            [usuario.id, codigoNormalizado]
        );

        if (resets.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Código inválido o expirado"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await db.query(
            "UPDATE usuarios SET password_hash = ? WHERE id = ?",
            [passwordHash, usuario.id]
        );

        await db.query(
            "UPDATE password_resets SET usado = 1 WHERE id = ?",
            [resets[0].id]
        );

        res.json({
            success: true,
            message: "Contraseña actualizada correctamente"
        });

    } catch (error) {
        console.error("Error reset-password:", error);

        res.status(500).json({
            success: false,
            error: "Error del servidor"
        });
    }
});


module.exports = router;
