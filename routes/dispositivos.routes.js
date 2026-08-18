const express = require("express");
const router = express.Router();
const db = require("../config/db");

/** La app llama esto cada vez que tiene un token de notificaciones nuevo
 * (al iniciar sesión, o cuando Firebase se lo renueva). */
router.post("/registrar", async (req, res) => {
    try {
        const { usuario_id, token_push, plataforma, modelo_dispositivo } = req.body;

        if (!usuario_id || !token_push) {
            return res.status(400).json({ success: false, error: "Faltan datos" });
        }

        const [existente] = await db.query(
            `SELECT id FROM dispositivos_usuario WHERE usuario_id = ? AND token_push = ?`,
            [usuario_id, token_push]
        );

        if (existente.length > 0) {
            await db.query(
                `UPDATE dispositivos_usuario SET activo = 1, modelo_dispositivo = ? WHERE id = ?`,
                [modelo_dispositivo || null, existente[0].id]
            );
        } else {
            await db.query(
                `INSERT INTO dispositivos_usuario (usuario_id, plataforma, token_push, modelo_dispositivo, activo, fecha_registro)
                 VALUES (?, ?, ?, ?, 1, NOW())`,
                [usuario_id, plataforma || "android", token_push, modelo_dispositivo || null]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Error al registrar dispositivo:", error);
        res.status(500).json({ success: false, error: "Error del servidor" });
    }
});

module.exports = router;
