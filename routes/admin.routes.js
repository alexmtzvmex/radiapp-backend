const express = require("express");
const router = express.Router();

const db = require("../config/db");

router.get("/usuarios-pendientes", async (req, res) => {

    try {

        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus
            FROM usuarios
            WHERE estatus = 'pendiente'
            ORDER BY fecha_registro DESC
        `);

        res.json({
            success: true,
            usuarios
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error obteniendo usuarios"
        });
    }
});

router.put("/aprobar/:id", async (req, res) => {

    try {

        const id = req.params.id;

        await db.query(`
            UPDATE usuarios
            SET estatus = 'activo'
            WHERE id = ?
        `, [id]);

        res.json({
            success: true,
            message: "Usuario aprobado correctamente"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error aprobando usuario"
        });
    }
});

module.exports = router;
