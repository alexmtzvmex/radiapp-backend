const admin = require("firebase-admin");
const db = require("./db");

// La cuenta de servicio de Firebase se lee de variables de entorno, NUNCA de
// un archivo en el repo — el repo de GitHub es público, y ese archivo tiene
// una llave privada que le daría a cualquiera control total sobre tu
// proyecto de Firebase si se subiera por accidente.
let inicializado = false;

function inicializarFirebase() {
    if (inicializado) return;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
        console.warn("Firebase no configurado (faltan variables de entorno) — las notificaciones push no van a funcionar todavía.");
        return;
    }

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey
        })
    });
    inicializado = true;
    console.log("Firebase Admin inicializado — notificaciones push activas.");
}

/**
 * Manda una notificación a todos los integrantes autorizados de un canal
 * que tengan un token registrado Y que NO estén ya conectados ahorita mismo
 * a ese canal (a esos no hace falta avisarles, ya lo están escuchando en
 * vivo). `socketIdsConectados` es la lista de socket_id ya presentes.
 */
async function notificarCanalOffline(canalId, usuarioQueHabla, usuarioIdQueHabla, usuariosConectadosIds) {
    if (!inicializado) return;

    try {
        const idsAExcluir = Array.from(new Set([usuarioIdQueHabla || 0, ...(usuariosConectadosIds || [])]));
        const placeholders = idsAExcluir.map(() => "?").join(",") || "0";

        const [filas] = await db.query(
            `SELECT DISTINCT du.token_push, du.usuario_id
             FROM canal_miembros cm
             JOIN dispositivos_usuario du ON du.usuario_id = cm.usuario_id
             WHERE cm.canal_id = ?
               AND cm.autorizado = 1
               AND du.activo = 1
               AND du.token_push IS NOT NULL
               AND cm.usuario_id NOT IN (${placeholders})`,
            [canalId, ...idsAExcluir]
        );

        const tokens = filas.map(f => f.token_push).filter(Boolean);
        if (tokens.length === 0) return;

        await admin.messaging().sendEachForMulticast({
            tokens,
            notification: {
                title: `${usuarioQueHabla} está hablando`,
                body: `Canal activo — toca para abrir RadiApp`
            },
            data: {
                canal_id: String(canalId)
            },
            android: {
                priority: "high"
            }
        });
    } catch (error) {
        console.error("Error al mandar notificación push:", error);
    }
}

module.exports = { inicializarFirebase, notificarCanalOffline };
