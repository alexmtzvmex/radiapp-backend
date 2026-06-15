const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const db = require("../config/db");

router.get("/validar", async (req, res) => {
    try {
        // Temporal mientras terminamos middleware JWT completo
        res.json({ success: true });
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

        res.json({ success: true, usuarios });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo usuarios" });
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

        res.json({ success: true, usuarios });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo usuarios activos" });
    }
});

router.get("/usuarios", async (req, res) => {
    try {
        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, rol, estatus
            FROM usuarios
            WHERE estatus = 'activo'
            ORDER BY nombre_completo ASC
        `);

        res.json({ success: true, usuarios });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo usuarios" });
    }
});

router.get("/canales", async (req, res) => {
    try {
        const [canales] = await db.query(`
            SELECT *
            FROM canales
            ORDER BY id DESC
        `);

        res.json({ success: true, canales });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo canales" });
    }
});

router.put("/aprobar/:id", async (req, res) => {
    try {
        await db.query(`
            UPDATE usuarios
            SET estatus = 'activo'
            WHERE id = ?
        `, [req.params.id]);

        res.json({
            success: true,
            message: "Usuario aprobado correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error aprobando usuario" });
    }
});

router.put("/rechazar/:id", async (req, res) => {
    try {
        await db.query(`
            UPDATE usuarios
            SET estatus = 'rechazado'
            WHERE id = ?
        `, [req.params.id]);

        res.json({
            success: true,
            message: "Usuario bloqueado correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error bloqueando usuario" });
    }
});

router.put("/usuarios/:id/rol", async (req, res) => {
    try {
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
        `, [rol, req.params.id]);

        res.json({
            success: true,
            message: "Rol actualizado correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error actualizando rol" });
    }
});

router.put("/usuarios/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const nombre = String(req.body.nombre_completo || "").trim();
        const correo = String(req.body.correo || "").trim().toLowerCase();
        const rol = String(req.body.rol || "usuario").toLowerCase().trim();
        const estatus = String(req.body.estatus || "activo").toLowerCase().trim();

        const rolesPermitidos = ["usuario", "supervisor", "admin"];
        const estatusPermitidos = ["pendiente", "activo", "rechazado", "eliminado"];

        if (!nombre || !correo) {
            return res.status(400).json({
                success: false,
                error: "Nombre y correo son obligatorios"
            });
        }

        if (!rolesPermitidos.includes(rol)) {
            return res.status(400).json({
                success: false,
                error: "Rol no permitido"
            });
        }

        if (!estatusPermitidos.includes(estatus)) {
            return res.status(400).json({
                success: false,
                error: "Estatus no permitido"
            });
        }

        await db.query(`
            UPDATE usuarios
            SET nombre_completo = ?, correo = ?, rol = ?, estatus = ?
            WHERE id = ?
        `, [nombre, correo, rol, estatus, id]);

        res.json({
            success: true,
            message: "Usuario actualizado correctamente"
        });
    } catch (error) {
        console.error(error);

        if (String(error.code || "").includes("DUP")) {
            return res.status(409).json({
                success: false,
                error: "Ya existe otro usuario con ese correo"
            });
        }

        res.status(500).json({
            success: false,
            error: "Error actualizando usuario"
        });
    }
});

router.delete("/usuarios/:id", async (req, res) => {
    try {
        const id = req.params.id;

        // Eliminación lógica para no romper historial/canales/relaciones.
        await db.query(`
            UPDATE usuarios
            SET estatus = 'eliminado'
            WHERE id = ?
        `, [id]);

        await db.query(`
            UPDATE canal_miembros
            SET autorizado = 0
            WHERE usuario_id = ?
        `, [id]).catch(() => {});

        res.json({
            success: true,
            message: "Usuario eliminado correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error eliminando usuario"
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

        res.json({ success: true, message: "Canal desactivado correctamente" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error desactivando canal" });
    }
});

router.put("/canales/activar/:id", async (req, res) => {
    try {
        await db.query(`
            UPDATE canales
            SET activo = 1
            WHERE id = ?
        `, [req.params.id]);

        res.json({ success: true, message: "Canal activado correctamente" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error activando canal" });
    }
});

router.put("/canales/visibilidad/:id", async (req, res) => {
    try {
        const visiblePublico = Number(req.body.visible_publico) === 1 ? 1 : 0;

        await db.query(`
            UPDATE canales
            SET visible_publico = ?
            WHERE id = ?
        `, [visiblePublico, req.params.id]);

        res.json({ success: true, message: "Visibilidad actualizada correctamente" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error actualizando visibilidad" });
    }
});

router.put("/canales/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const nombre = String(req.body.nombre_canal || "").trim();
        const descripcion = String(req.body.descripcion || "").trim();
        const privado = Number(req.body.privado) === 1 ? 1 : 0;
        const visiblePublico = Number(req.body.visible_publico) === 1 ? 1 : 0;
        const activo = Number(req.body.activo) === 1 ? 1 : 0;
        const passwordCanal = String(req.body.password_canal || "").trim();

        if (!nombre) {
            return res.status(400).json({
                success: false,
                error: "El nombre del canal es obligatorio"
            });
        }

        if (privado === 1 && passwordCanal) {
            const passwordHash = await bcrypt.hash(passwordCanal, 10);

            await db.query(`
                UPDATE canales
                SET nombre_canal = ?, descripcion = ?, privado = ?, visible_publico = ?, activo = ?, password_hash = ?
                WHERE id = ?
            `, [nombre, descripcion || null, privado, visiblePublico, activo, passwordHash, id]);
        } else {
            await db.query(`
                UPDATE canales
                SET nombre_canal = ?, descripcion = ?, privado = ?, visible_publico = ?, activo = ?
                WHERE id = ?
            `, [nombre, descripcion || null, privado, visiblePublico, activo, id]);
        }

        res.json({
            success: true,
            message: "Canal actualizado correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error actualizando canal"
        });
    }
});

router.delete("/canales/:id", async (req, res) => {
    const id = req.params.id;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        await connection.query(`
            DELETE FROM canal_miembros
            WHERE canal_id = ?
        `, [id]).catch(() => {});

        await connection.query(`
            DELETE FROM canales
            WHERE id = ?
        `, [id]);

        await connection.commit();

        res.json({
            success: true,
            message: "Canal eliminado correctamente"
        });
    } catch (error) {
        await connection.rollback();
        console.error(error);

        res.status(500).json({
            success: false,
            error: "Error eliminando canal"
        });
    } finally {
        connection.release();
    }
});

router.get("/canales/:id/miembros", async (req, res) => {
    try {
        const [miembros] = await db.query(`
            SELECT
                cm.usuario_id,
                cm.rol,
                cm.autorizado,
                u.nombre_completo,
                u.correo
            FROM canal_miembros cm
            INNER JOIN usuarios u ON u.id = cm.usuario_id
            WHERE cm.canal_id = ?
            AND cm.autorizado = 1
            ORDER BY u.nombre_completo ASC
        `, [req.params.id]);

        res.json({ success: true, miembros });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error cargando miembros" });
    }
});

router.post("/canales/:id/agregar-miembro", async (req, res) => {
    try {
        const canalId = req.params.id;
        const usuarioId = req.body.usuario_id;

        if (!usuarioId) {
            return res.status(400).json({
                success: false,
                error: "Usuario requerido"
            });
        }

        await db.query(`
            INSERT INTO canal_miembros (canal_id, usuario_id, rol, autorizado)
            VALUES (?, ?, 'miembro', 1)
            ON DUPLICATE KEY UPDATE autorizado = 1, rol = VALUES(rol)
        `, [canalId, usuarioId]);

        res.json({
            success: true,
            message: "Usuario agregado correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error agregando miembro"
        });
    }
});

router.put("/canales/:id/quitar-miembro/:usuario", async (req, res) => {
    try {
        await db.query(`
            UPDATE canal_miembros
            SET autorizado = 0
            WHERE canal_id = ?
            AND usuario_id = ?
        `, [req.params.id, req.params.usuario]);

        res.json({
            success: true,
            message: "Usuario removido correctamente"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error quitando miembro"
        });
    }
});

module.exports = router;
