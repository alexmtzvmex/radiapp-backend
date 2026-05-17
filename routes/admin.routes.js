const express = require("express");
const router = express.Router();

const db = require("../config/db");

router.get("/usuarios-pendientes", async (req, res) => {
    try {
        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus, fecha_registro
            FROM usuarios
            WHERE estatus = 'pendiente'
            ORDER BY fecha_registro DESC, id DESC
        `);

        return res.json({
            success: true,
            usuarios
        });

    } catch (error) {
        console.error("Error en /api/admin/usuarios-pendientes:", error);

        return res.status(500).json({
            success: false,
            error: "Error obteniendo usuarios pendientes"
        });
    }
});

router.put("/aprobar/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "ID de usuario inválido"
            });
        }

        const [resultado] = await db.query(
            `UPDATE usuarios
             SET estatus = 'activo'
             WHERE id = ? AND estatus = 'pendiente'`,
            [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: "No se encontró un usuario pendiente con ese ID"
            });
        }

        return res.json({
            success: true,
            message: "Usuario aprobado correctamente"
        });

    } catch (error) {
        console.error("Error en /api/admin/aprobar/:id:", error);

        return res.status(500).json({
            success: false,
            error: "Error aprobando usuario"
        });
    }
});

router.put("/rechazar/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "ID de usuario inválido"
            });
        }

        const [resultado] = await db.query(
            `UPDATE usuarios
             SET estatus = 'rechazado'
             WHERE id = ? AND estatus = 'pendiente'`,
            [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: "No se encontró un usuario pendiente con ese ID"
            });
        }

        return res.json({
            success: true,
            message: "Usuario rechazado correctamente"
        });

    } catch (error) {
        console.error("Error en /api/admin/rechazar/:id:", error);

        return res.status(500).json({
            success: false,
            error: "Error rechazando usuario"
        });
    }
});

module.exports = router;
