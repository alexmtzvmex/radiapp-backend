const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const db = require("../config/db");

router.post("/crear", async (req, res) => {
    try {
        const { nombre_canal, descripcion, password_canal, creado_por } = req.body;

        if (!nombre_canal || !creado_por) {
            return res.status(400).json({
                success: false,
                error: "Nombre del canal y usuario creador son obligatorios"
            });
        }

        let passwordHash = null;

        if (password_canal && String(password_canal).trim() !== "") {
            passwordHash = await bcrypt.hash(String(password_canal), 10);
        }

        const [result] = await db.query(
            `INSERT INTO canales 
            (nombre_canal, descripcion, password_hash, privado, creado_por, activo)
            VALUES (?, ?, ?, ?, ?, 1)`,
            [
                nombre_canal,
                descripcion || null,
                passwordHash,
                passwordHash ? 1 : 0,
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
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error creando canal"
        });
    }
});

router.get("/listar", async (req, res) => {
    try {
        const [canales] = await db.query(`
            SELECT 
                c.id,
                c.nombre_canal,
                c.descripcion,
                c.privado,
                c.activo,
                c.fecha_creacion,
                u.nombre_completo AS creado_por
            FROM canales c
            INNER JOIN usuarios u ON u.id = c.creado_por
            WHERE c.activo = 1
            ORDER BY c.fecha_creacion DESC
        `);

        res.json({
            success: true,
            canales
        });

    } catch (error) {
        console.error(error);
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
            `SELECT id, nombre_canal, descripcion, password_hash, privado, activo
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

        if (canal.activo !== 1) {
            return res.status(403).json({
                success: false,
                error: "Canal inactivo"
            });
        }

        if (!canal.privado || !canal.password_hash) {
            return res.json({
                success: true,
                message: "Acceso permitido",
                canal: {
                    id: canal.id,
                    nombre_canal: canal.nombre_canal,
                    descripcion: canal.descripcion,
                    privado: canal.privado
                }
            });
        }

        if (!password_canal) {
            return res.status(400).json({
                success: false,
                error: "Contraseña del canal requerida"
            });
        }

        let passwordCorrecto = false;

        // Soporte para canales antiguos que quedaron guardados en texto plano antes de activar bcrypt.
        if (String(canal.password_hash).startsWith("$2a$") || String(canal.password_hash).startsWith("$2b$") || String(canal.password_hash).startsWith("$2y$")) {
            passwordCorrecto = await bcrypt.compare(String(password_canal), canal.password_hash);
        } else {
            passwordCorrecto = String(password_canal) === String(canal.password_hash);

            // Si coincide con contraseña antigua en texto plano, se actualiza a hash automáticamente.
            if (passwordCorrecto) {
                const nuevoHash = await bcrypt.hash(String(password_canal), 10);
                await db.query(
                    "UPDATE canales SET password_hash = ? WHERE id = ?",
                    [nuevoHash, canal.id]
                );
            }
        }

        if (!passwordCorrecto) {
            return res.status(401).json({
                success: false,
                error: "Contraseña incorrecta"
            });
        }

        if (usuario_id) {
            await db.query(
                `INSERT INTO canal_miembros (canal_id, usuario_id, rol, autorizado)
                 VALUES (?, ?, 'miembro', 1)
                 ON DUPLICATE KEY UPDATE autorizado = 1`,
                [canal.id, usuario_id]
            ).catch(() => {});
        }

        res.json({
            success: true,
            message: "Acceso permitido",
            canal: {
                id: canal.id,
                nombre_canal: canal.nombre_canal,
                descripcion: canal.descripcion,
                privado: canal.privado
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error validando acceso al canal"
        });
    }
});

module.exports = router;
