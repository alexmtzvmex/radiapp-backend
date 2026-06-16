const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

function obtenerToken(req) {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) return null;
    return auth.slice(7).trim();
}

async function validarTokenAdmin(req, res, next) {
    try {
        const token = obtenerToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                error: "Sesión no válida. Inicia sesión nuevamente."
            });
        }

        if (!process.env.JWT_SECRET) {
            return res.status(500).json({
                success: false,
                error: "JWT_SECRET no está configurado en Render."
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus, rol
            FROM usuarios
            WHERE id = ?
            LIMIT 1
        `, [decoded.id]);

        if (usuarios.length === 0) {
            return res.status(401).json({
                success: false,
                error: "Usuario no encontrado."
            });
        }

        const usuario = usuarios[0];

        if (usuario.estatus !== "activo") {
            return res.status(403).json({
                success: false,
                error: "Usuario no activo."
            });
        }

        if (usuario.rol !== "admin") {
            return res.status(403).json({
                success: false,
                error: "Acceso permitido únicamente a administradores."
            });
        }

        req.admin = usuario;
        next();

    } catch (error) {
        console.error("Error validando JWT admin:", error.message);

        return res.status(401).json({
            success: false,
            error: "Sesión vencida o token inválido. Inicia sesión nuevamente."
        });
    }
}

router.use(validarTokenAdmin);

router.get("/validar", async (req, res) => {
    res.json({
        success: true,
        admin: {
            id: req.admin.id,
            nombre_completo: req.admin.nombre_completo,
            correo: req.admin.correo,
            rol: req.admin.rol
        }
    });
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
            SELECT id, nombre_completo, correo, estatus, rol
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
            return res.status(400).json({ success:false, error:"Nombre y correo son obligatorios" });
        }

        if (!rolesPermitidos.includes(rol)) {
            return res.status(400).json({ success:false, error:"Rol no permitido" });
        }

        if (!estatusPermitidos.includes(estatus)) {
            return res.status(400).json({ success:false, error:"Estatus no permitido" });
        }

        await db.query(`
            UPDATE usuarios
            SET nombre_completo = ?, correo = ?, rol = ?, estatus = ?
            WHERE id = ?
        `, [nombre, correo, rol, estatus, id]);

        res.json({ success:true, message:"Usuario actualizado correctamente" });
    } catch (error) {
        console.error("Error actualizando usuario:", error);
        res.status(500).json({ success:false, error:"Error actualizando usuario" });
    }
});

router.delete("/usuarios/:id", async (req, res) => {
    try {
        const id = req.params.id;

        await db.query(`
            UPDATE usuarios
            SET estatus = 'eliminado'
            WHERE id = ?
        `, [id]);

        try {
            await db.query(`UPDATE canal_miembros SET autorizado = 0 WHERE usuario_id = ?`, [id]);
        } catch(e) {}

        res.json({ success:true, message:"Usuario eliminado correctamente" });
    } catch (error) {
        console.error("Error eliminando usuario:", error);
        res.status(500).json({ success:false, error:"Error eliminando usuario" });
    }
});

router.put("/canales/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const nombre = String(req.body.nombre_canal || "").trim();
        const descripcion = String(req.body.descripcion || "").trim();
        const privado = Number(req.body.privado) === 1 ? 1 : 0;
        const visible_publico = Number(req.body.visible_publico) === 1 ? 1 : 0;
        const activo = Number(req.body.activo) === 1 ? 1 : 0;
        const password_canal = String(req.body.password_canal || "").trim();

        if (!nombre) {
            return res.status(400).json({ success:false, error:"El nombre del canal es obligatorio" });
        }

        if (privado === 1 && password_canal) {
            const passwordHash = await bcrypt.hash(password_canal, 10);
            await db.query(`
                UPDATE canales
                SET nombre_canal = ?, descripcion = ?, privado = ?, visible_publico = ?, activo = ?, password_hash = ?
                WHERE id = ?
            `, [nombre, descripcion || null, privado, visible_publico, activo, passwordHash, id]);
        } else if (privado === 0) {
            await db.query(`
                UPDATE canales
                SET nombre_canal = ?, descripcion = ?, privado = ?, visible_publico = ?, activo = ?, password_hash = NULL
                WHERE id = ?
            `, [nombre, descripcion || null, privado, visible_publico, activo, id]);
        } else {
            await db.query(`
                UPDATE canales
                SET nombre_canal = ?, descripcion = ?, privado = ?, visible_publico = ?, activo = ?
                WHERE id = ?
            `, [nombre, descripcion || null, privado, visible_publico, activo, id]);
        }

        res.json({ success:true, message:"Canal actualizado correctamente" });
    } catch (error) {
        console.error("Error actualizando canal:", error);
        res.status(500).json({ success:false, error:"Error actualizando canal" });
    }
});

router.delete("/canales/:id", async (req, res) => {
    try {
        const id = req.params.id;

        try {
            await db.query(`DELETE FROM canal_miembros WHERE canal_id = ?`, [id]);
        } catch(e) {}

        await db.query(`DELETE FROM canales WHERE id = ?`, [id]);

        res.json({ success:true, message:"Canal eliminado correctamente" });
    } catch (error) {
        console.error("Error eliminando canal:", error);
        try {
            await db.query(`UPDATE canales SET activo = 0, visible_publico = 0 WHERE id = ?`, [req.params.id]);
            return res.json({ success:true, message:"Canal desactivado correctamente" });
        } catch(e) {}
        res.status(500).json({ success:false, error:"Error eliminando canal" });
    }
});

router.get("/canales/:id/miembros", async (req, res) => {
    try {
        const [miembros] = await db.query(`
            SELECT cm.usuario_id, cm.rol, cm.autorizado, u.nombre_completo, u.correo
            FROM canal_miembros cm
            INNER JOIN usuarios u ON u.id = cm.usuario_id
            WHERE cm.canal_id = ?
              AND cm.autorizado = 1
              AND COALESCE(u.estatus,'activo') <> 'eliminado'
            ORDER BY u.nombre_completo ASC
        `, [req.params.id]);

        res.json({ success:true, miembros });
    } catch (error) {
        console.error("Error obteniendo miembros:", error);
        res.status(500).json({ success:false, error:"Error obteniendo miembros" });
    }
});

router.post("/canales/:id/agregar-miembro", async (req, res) => {
    try {
        const canalId = req.params.id;
        const usuarioId = req.body.usuario_id;

        if (!usuarioId) {
            return res.status(400).json({ success:false, error:"Usuario requerido" });
        }

        const [existente] = await db.query(`
            SELECT id FROM canal_miembros
            WHERE canal_id = ? AND usuario_id = ?
            LIMIT 1
        `, [canalId, usuarioId]);

        if (existente.length > 0) {
            await db.query(`
                UPDATE canal_miembros
                SET autorizado = 1, rol = 'miembro'
                WHERE canal_id = ? AND usuario_id = ?
            `, [canalId, usuarioId]);
        } else {
            await db.query(`
                INSERT INTO canal_miembros (canal_id, usuario_id, rol, autorizado)
                VALUES (?, ?, 'miembro', 1)
            `, [canalId, usuarioId]);
        }

        res.json({ success:true, message:"Miembro agregado correctamente" });
    } catch (error) {
        console.error("Error agregando miembro:", error);
        res.status(500).json({ success:false, error:"Error agregando miembro" });
    }
});

router.put("/canales/:id/quitar-miembro/:usuario", async (req, res) => {
    try {
        await db.query(`
            UPDATE canal_miembros
            SET autorizado = 0
            WHERE canal_id = ? AND usuario_id = ?
        `, [req.params.id, req.params.usuario]);

        res.json({ success:true, message:"Miembro removido correctamente" });
    } catch (error) {
        console.error("Error quitando miembro:", error);
        res.status(500).json({ success:false, error:"Error quitando miembro" });
    }
});

module.exports = router;
