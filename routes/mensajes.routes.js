const express = require("express");
const router = express.Router();
const db = require("../config/db");

/**
 * Guarda un mensaje de voz grabado (base64) para poder reproducirlo después
 * — la parte de "lo que te perdiste" de RadiApp.
 * Se guardan directo en MySQL (no en disco) porque en Render el disco se
 * borra en cada reinicio del servicio gratuito.
 */
router.post("/subir", async (req, res) => {
    try {
        const { canal_id, usuario, usuario_id, audio_base64, duracion_seg } = req.body;

        if (!canal_id || !usuario || !audio_base64) {
            return res.status(400).json({ success: false, error: "Faltan datos del mensaje" });
        }

        // Límite de tamaño razonable (~2 minutos de audio comprimido) para no
        // llenar la base de datos con clips gigantes.
        const tamanioAprox = Buffer.byteLength(audio_base64, "base64");
        if (tamanioAprox > 8 * 1024 * 1024) {
            return res.status(413).json({ success: false, error: "El mensaje es demasiado largo" });
        }

        const [resultado] = await db.query(
            `INSERT INTO mensajes_voz (canal_id, usuario, usuario_id, audio_base64, duracion_seg, creado_en)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [canal_id, usuario, usuario_id || null, audio_base64, duracion_seg || null]
        );

        res.json({ success: true, id: resultado.insertId });
    } catch (error) {
        console.error("Error al guardar mensaje de voz:", error);
        res.status(500).json({ success: false, error: "Error del servidor" });
    }
});

/** Lista los últimos mensajes de un canal (SIN el audio, para que sea ligero). */
router.get("/listar/:canal_id", async (req, res) => {
    try {
        const { canal_id } = req.params;
        const limite = Math.min(parseInt(req.query.limite) || 30, 100);

        const [filas] = await db.query(
            `SELECT id, canal_id, usuario, duracion_seg, creado_en
             FROM mensajes_voz
             WHERE canal_id = ?
             ORDER BY creado_en DESC
             LIMIT ?`,
            [canal_id, limite]
        );

        res.json({ success: true, mensajes: filas });
    } catch (error) {
        console.error("Error al listar mensajes de voz:", error);
        res.status(500).json({ success: false, error: "Error del servidor" });
    }
});

/** Trae el audio de un mensaje específico (solo cuando el usuario le da play). */
router.get("/:id/audio", async (req, res) => {
    try {
        const { id } = req.params;
        const [filas] = await db.query(
            `SELECT audio_base64 FROM mensajes_voz WHERE id = ?`,
            [id]
        );

        if (filas.length === 0) {
            return res.status(404).json({ success: false, error: "Mensaje no encontrado" });
        }

        res.json({ success: true, audio_base64: filas[0].audio_base64 });
    } catch (error) {
        console.error("Error al obtener audio:", error);
        res.status(500).json({ success: false, error: "Error del servidor" });
    }
});

module.exports = router;
