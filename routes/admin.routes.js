const express = require("express");
const router = express.Router();

const db = require("../config/db");

router.get("/validar", async (req, res) => {
    try {

        // Temporal mientras terminamos middleware JWT completo
        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            error: "Error validando admin"
        });
    }
});

router.get("/usuarios-pendientes", async (req, res) => {

    try {

        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus, rol
            FROM usuarios
            WHERE estatus = 'pendiente'
            ORDER BY id DESC
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

router.get("/usuarios-activos", async (req, res) => {

    try {

        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus, rol
            FROM usuarios
            WHERE estatus = 'activo'
            ORDER BY id DESC
        `);

        res.json({
            success: true,
            usuarios
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error obteniendo usuarios activos"
        });
    }
});

router.get("/usuarios", async (req, res) => {

    try {

        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, rol
            FROM usuarios
            WHERE estatus = 'activo'
            ORDER BY nombre_completo ASC
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

router.get("/canales", async (req, res) => {

    try {

        const [canales] = await db.query(`
            SELECT *
            FROM canales
            ORDER BY id DESC
        `);

        res.json({
            success: true,
            canales
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error obteniendo canales"
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

router.put("/rechazar/:id", async (req, res) => {

    try {

        const id = req.params.id;

        await db.query(`
            UPDATE usuarios
            SET estatus = 'rechazado'
            WHERE id = ?
        `, [id]);

        res.json({
            success: true,
            message: "Usuario bloqueado correctamente"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error bloqueando usuario"
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

        await db.query(`
            UPDATE usuarios
            SET rol = ?
            WHERE id = ?
        `, [rol, id]);

        res.json({
            success: true,
            message: "Rol actualizado correctamente"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Error actualizando rol"
        });
    }
});

router.put("/canales/desactivar/:id", async (req, res) => {

    try {

        await db.query(`
            UPDATE canales
            SET activo = 0
            WHERE id = ?
        `, [req.params.id]);

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            success: false
        });
    }
});

router.put("/canales/activar/:id", async (req, res) => {

    try {

        await db.query(`
            UPDATE canales
            SET activo = 1
            WHERE id = ?
        `, [req.params.id]);

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            success: false
        });
    }
});

router.put("/canales/visibilidad/:id", async (req, res) => {

    try {

        const { visible_publico } = req.body;

        await db.query(`
            UPDATE canales
            SET visible_publico = ?
            WHERE id = ?
        `, [visible_publico, req.params.id]);

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            success: false
        });
    }
});

router.get("/canales/:id/miembros", async (req, res) => {

    try {

        res.json({
            success: true,
            miembros: []
        });

    } catch (error) {

        res.status(500).json({
            success: false
        });
    }
});

router.post("/canales/:id/agregar-miembro", async (req, res) => {

    res.json({
        success: true
    });
});

router.put("/canales/:id/quitar-miembro/:usuario", async (req, res) => {

    res.json({
        success: true
    });
});

module.exports = router;
