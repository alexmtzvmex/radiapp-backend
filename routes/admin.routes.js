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


router.put("/usuarios/:id/rol", async (req, res) => {
    try {
        const id = req.params.id;
        const rol = String(req.body.rol || "").toLowerCase().trim();

        const rolesPermitidos = ["usuario", "supervisor", "admin"];

        if (!rolesPermitidos.includes(rol)) {
            return res.status(400).json({
                success: false,
                error: "Rol no permitido"
            });
        }

        if (Number(id) === Number(req.usuario.id) && rol !== "admin") {
            return res.status(400).json({
                success: false,
                error: "No puedes quitarte tu propio rol de administrador desde esta pantalla"
            });
        }

        await db.query(
            "UPDATE usuarios SET rol = ?, estatus = 'activo' WHERE id = ?",
            [rol, id]
        );

        res.json({
            success: true,
            message: "Rol actualizado correctamente"
        });

    } catch (error) {
        console.error("Error actualizando rol:", error);

        res.status(500).json({
            success: false,
            error: "Error actualizando rol"
        });
    }
});


module.exports = router;
