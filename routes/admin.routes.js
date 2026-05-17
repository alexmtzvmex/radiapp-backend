const express = require("express");
const router = express.Router();

const jwt = require("jsonwebtoken");
const db = require("../config/db");

function verificarToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.substring(7)
            : null;

        if (!token) {
            return res.status(401).json({
                success: false,
                error: "Token requerido"
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = decoded;
        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            error: "Sesión inválida o expirada"
        });
    }
}

async function soloAdmin(req, res, next) {
    try {
        const [usuarios] = await db.query(
            "SELECT id, correo, rol, estatus FROM usuarios WHERE id = ? LIMIT 1",
            [req.usuario.id]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                success: false,
                error: "Usuario no encontrado"
            });
        }

        const usuario = usuarios[0];

        if (usuario.estatus !== "activo" || usuario.rol !== "admin") {
            return res.status(403).json({
                success: false,
                error: "Acceso denegado. Solo administradores."
            });
        }

        req.admin = usuario;
        next();

    } catch (error) {
        console.error("Error validando admin:", error);

        res.status(500).json({
            success: false,
            error: "Error validando permisos"
        });
    }
}

router.use(verificarToken);
router.use(soloAdmin);

router.get("/validar", async (req, res) => {
    res.json({
        success: true,
        message: "Acceso admin autorizado",
        usuario: req.admin
    });
});

router.get("/usuarios-pendientes", async (req, res) => {
    try {
        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus, rol, fecha_registro
            FROM usuarios
            WHERE estatus = 'pendiente'
            ORDER BY fecha_registro DESC
        `);

        res.json({ success: true, usuarios });

    } catch (error) {
        console.error("Error usuarios pendientes:", error);

        res.status(500).json({
            success: false,
            error: "Error obteniendo usuarios pendientes"
        });
    }
});

router.get("/usuarios-activos", async (req, res) => {
    try {
        const [usuarios] = await db.query(`
            SELECT id, nombre_completo, correo, estatus, rol, fecha_registro
            FROM usuarios
            WHERE estatus = 'activo'
            ORDER BY nombre_completo ASC
        `);

        res.json({ success: true, usuarios });

    } catch (error) {
        console.error("Error usuarios activos:", error);

        res.status(500).json({
            success: false,
            error: "Error obteniendo usuarios activos"
        });
    }
});

router.put("/aprobar/:id", async (req, res) => {
    try {
        const id = req.params.id;

        await db.query(
            "UPDATE usuarios SET estatus = 'activo' WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Usuario aprobado correctamente"
        });

    } catch (error) {
        console.error("Error aprobar usuario:", error);

        res.status(500).json({
            success: false,
            error: "Error aprobando usuario"
        });
    }
});

router.put("/rechazar/:id", async (req, res) => {
    try {
        const id = req.params.id;

        await db.query(
            "UPDATE usuarios SET estatus = 'rechazado' WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Usuario rechazado/bloqueado correctamente"
        });

    } catch (error) {
        console.error("Error rechazar usuario:", error);

        res.status(500).json({
            success: false,
            error: "Error rechazando usuario"
        });
    }
});

router.put("/hacer-admin/:id", async (req, res) => {
    try {
        const id = req.params.id;

        await db.query(
            "UPDATE usuarios SET rol = 'admin', estatus = 'activo' WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Usuario convertido en administrador"
        });

    } catch (error) {
        console.error("Error hacer admin:", error);

        res.status(500).json({
            success: false,
            error: "Error actualizando rol"
        });
    }
});

router.put("/quitar-admin/:id", async (req, res) => {
    try {
        const id = req.params.id;

        if (Number(id) === Number(req.usuario.id)) {
            return res.status(400).json({
                success: false,
                error: "No puedes quitarte el rol admin a ti mismo"
            });
        }

        await db.query(
            "UPDATE usuarios SET rol = 'usuario' WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Rol de administrador removido"
        });

    } catch (error) {
        console.error("Error quitar admin:", error);

        res.status(500).json({
            success: false,
            error: "Error actualizando rol"
        });
    }
});

router.get("/canales", async (req, res) => {
    try {
        const [canales] = await db.query(`
            SELECT 
                c.id,
                c.nombre_canal,
                c.descripcion,
                c.privado,
                c.visible_publico,
                c.activo,
                c.fecha_creacion,
                u.nombre_completo AS creado_por
            FROM canales c
            LEFT JOIN usuarios u ON u.id = c.creado_por
            ORDER BY c.fecha_creacion DESC
        `);

        res.json({ success: true, canales });

    } catch (error) {
        console.error("Error canales admin:", error);

        res.status(500).json({
            success: false,
            error: "Error obteniendo canales"
        });
    }
});

router.put("/canales/desactivar/:id", async (req, res) => {
    try {
        const id = req.params.id;

        await db.query(
            "UPDATE canales SET activo = 0 WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Canal desactivado correctamente"
        });

    } catch (error) {
        console.error("Error desactivar canal:", error);

        res.status(500).json({
            success: false,
            error: "Error desactivando canal"
        });
    }
});

router.put("/canales/activar/:id", async (req, res) => {
    try {
        const id = req.params.id;

        await db.query(
            "UPDATE canales SET activo = 1 WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Canal activado correctamente"
        });

    } catch (error) {
        console.error("Error activar canal:", error);

        res.status(500).json({
            success: false,
            error: "Error activando canal"
        });
    }
});

router.put("/canales/visibilidad/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const visible_publico = Number(req.body.visible_publico) === 1 ? 1 : 0;

        await db.query(
            "UPDATE canales SET visible_publico = ? WHERE id = ?",
            [visible_publico, id]
        );

        res.json({
            success: true,
            message: visible_publico === 1
                ? "Canal visible para todo el público"
                : "Canal oculto del público"
        });

    } catch (error) {
        console.error("Error cambiando visibilidad:", error);

        res.status(500).json({
            success: false,
            error: "Error cambiando visibilidad del canal"
        });
    }
});

module.exports = router;
