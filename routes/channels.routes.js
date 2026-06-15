const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const db = require("../config/db");

router.post("/crear", async (req, res) => {
    try {
        const {
            nombre_canal,
            descripcion,
            password_canal,
            privado,
            visible_publico,
            creado_por
        } = req.body;

        if (!nombre_canal || !creado_por) {
            return res.status(400).json({
                success: false,
                error: "Nombre del canal y usuario creador son obligatorios"
            });
        }

        const esPrivado = Number(privado) === 0 ? 0 : 1;
        const esVisiblePublico = Number(visible_publico) === 0 ? 0 : 1;

        if (esPrivado === 1 && !password_canal) {
            return res.status(400).json({
                success: false,
                error: "Los canales privados requieren contraseña"
            });
        }

        let passwordHash = null;

        if (esPrivado === 1 && password_canal) {
            passwordHash = await bcrypt.hash(password_canal, 10);
        }

        const [result] = await db.query(
            `INSERT INTO canales 
            (nombre_canal, descripcion, password_hash, privado, visible_publico, creado_por, activo)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [
                nombre_canal.trim(),
                descripcion || null,
                passwordHash,
                esPrivado,
                esVisiblePublico,
                creado_por
            ]
        );

        await db.query(
            `INSERT INTO canal_miembros
            (canal_id, usuario_id, rol, autorizado)
            VALUES (?, ?, 'admin_canal', 1)`,
            [result.insertId, creado_por]
        );

        res.json({
            success: true,
            message: "Canal creado correctamente",
            canal_id: result.insertId
        });

    } catch (error) {
        console.error("Error creando canal:", error);

        res.status(500).json({
            success: false,
            error: "Error creando canal"
        });
    }
});

router.get("/listar", async (req, res) => {
    try {
        const usuarioId = req.query.usuario_id || null;

        const [canales] = await db.query(`
            SELECT DISTINCT
                c.id,
                c.nombre_canal,
                c.descripcion,
                c.privado,
                c.visible_publico,
                c.activo,
                c.fecha_creacion,
                u.nombre_completo AS creado_por,
                CASE
                    WHEN cm.usuario_id IS NOT NULL THEN 1
                    ELSE 0
                END AS autorizado
            FROM canales c
            LEFT JOIN usuarios u ON u.id = c.creado_por
            LEFT JOIN canal_miembros cm
                ON cm.canal_id = c.id
                AND cm.usuario_id = ?
                AND cm.autorizado = 1
            WHERE c.activo = 1
            AND (
                c.visible_publico = 1
                OR c.creado_por = ?
                OR cm.usuario_id IS NOT NULL
            )
            ORDER BY c.fecha_creacion DESC
        `, [usuarioId, usuarioId]);

        res.json({
            success: true,
            canales
        });

    } catch (error) {
        console.error("Error listando canales:", error);

        res.status(500).json({
            success: false,
            error: "Error listando canales"
        });
    }
});

router.post("/validar-acceso", async (req, res) => {
    try {
        const { canal_id, password_canal, usuario_id } = req.body;

        if (!canal_id) {
            return res.status(400).json({
                success: false,
                error: "Canal requerido"
            });
        }

        const [canales] = await db.query(
            `SELECT id, nombre_canal, privado, visible_publico, password_hash, activo, creado_por
             FROM canales
             WHERE id = ?
             LIMIT 1`,
            [canal_id]
        );

        if (canales.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Canal no encontrado"
            });
        }

        const canal = canales[0];

        if (Number(canal.activo) !== 1) {
            return res.status(403).json({
                success: false,
                error: "Canal inactivo"
            });
        }

        if (Number(canal.visible_publico) !== 1 && Number(canal.creado_por) !== Number(usuario_id)) {
            const [miembro] = await db.query(
                `SELECT id
                 FROM canal_miembros
                 WHERE canal_id = ?
                 AND usuario_id = ?
                 AND autorizado = 1
                 LIMIT 1`,
                [canal_id, usuario_id]
            );

            if (miembro.length === 0) {
                return res.status(403).json({
                    success: false,
                    error: "No estás autorizado para entrar a este canal"
                });
            }
        }

        if (Number(canal.privado) !== 1) {
            return res.json({
                success: true,
                message: "Canal abierto"
            });
        }

        if (!password_canal) {
            return res.status(400).json({
                success: false,
                error: "Contraseña requerida"
            });
        }

        let acceso = false;

        if (canal.password_hash && canal.password_hash.startsWith("$2")) {
            acceso = await bcrypt.compare(password_canal, canal.password_hash);
        } else {
            acceso = password_canal === canal.password_hash;
        }

        if (!acceso) {
            return res.status(401).json({
                success: false,
                error: "Contraseña incorrecta"
            });
        }

        res.json({
            success: true,
            message: "Acceso autorizado"
        });

    } catch (error) {
        console.error("Error validando acceso:", error);

        res.status(500).json({
            success: false,
            error: "Error validando acceso al canal"
        });
    }
});

module.exports = router;
