const express = require("express");
const router = express.Router();

const db = require("../config/db");

router.post("/crear", async (req, res) => {
    try {
        const { nombre_canal, descripcion, password_canal, creado_por } = req.body;

        if (!nombre_canal || !creado_por) {
            return res.status(400).json({
                error: "Nombre del canal y usuario creador son obligatorios"
            });
        }

        const [result] = await db.query(
            `INSERT INTO canales 
            (nombre_canal, descripcion, password_hash, privado, creado_por, activo)
            VALUES (?, ?, ?, 1, ?, 1)`,
            [nombre_canal, descripcion || null, password_canal || null, creado_por]
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
            error: "Error listando canales"
        });
    }
});

module.exports = router;
