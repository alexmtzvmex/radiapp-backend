const express = require("express");
const router = express.Router();
const db = require("../config/db");

/** Bitácora: quién habló, cuándo, y cuánto tiempo, en un canal. */
router.get("/:canal_id", async (req, res) => {
    try {
        const { canal_id } = req.params;
        const limite = Math.min(parseInt(req.query.limite) || 50, 200);

        const [filas] = await db.query(
            `SELECT sv.id, sv.canal_id, sv.usuario_id, u.nombre AS usuario,
                    sv.inicio, sv.fin, sv.duracion_segundos
             FROM sesiones_voz sv
             JOIN usuarios u ON u.id = sv.usuario_id
             WHERE sv.canal_id = ?
             ORDER BY sv.inicio DESC
             LIMIT ?`,
            [canal_id, limite]
        );

        res.json({ success: true, historial: filas });
    } catch (error) {
        console.error("Error al obtener historial:", error);
        res.status(500).json({ success: false, error: "Error del servidor" });
    }
});

module.exports = router;
