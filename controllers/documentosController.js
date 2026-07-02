const { Pool } = require('pg');
const path = require('path');
const docStorage = require('../helpers/docStorage');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function insertarAuditoria(pool, { entidadId, accion, descripcion, req }) {
    const userId   = req.session.user ? req.session.user.id   : null;
    const userName = req.session.user ? req.session.user.name : 'Sistema';
    try {
        await pool.query(
            `INSERT INTO im_auditoria (tabla_afectada, entidad_id, accion, descripcion, usuario_id, usuario_nombre)
             VALUES ('im_documentos', $1, $2, $3, $4, $5)`,
            [entidadId || null, accion, descripcion, userId, userName]
        );
    } catch (_) {}
}

exports.testStorage = async (req, res) => {
    try {
        const result = await docStorage.testStorage();
        res.json({ ok: result.wasabi?.ok || result.cloudinary?.ok, ...result });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
};

exports.uploadDocumento = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo. Verifica que seleccionaste un archivo válido.' });

        const { nombre_personalizado, tipo_asociacion, asociacion_id } = req.body;
        if (!tipo_asociacion || !asociacion_id)
            return res.status(400).json({ message: 'Faltan campos obligatorios: tipo_asociacion y asociacion_id.' });

        const tiposValidos = ['proyecto', 'parcela', 'persona', 'venta'];
        if (!tiposValidos.includes(tipo_asociacion))
            return res.status(400).json({ message: `tipo_asociacion inválido. Debe ser: ${tiposValidos.join(', ')}` });

        const nombreFinal = (nombre_personalizado && nombre_personalizado.trim())
            ? nombre_personalizado.trim()
            : req.file.originalname.replace(/\.[^/.]+$/, '');

        const ext = path.extname(req.file.originalname).toLowerCase() || '.bin';
        const timestamp = Date.now();
        const safeId = String(asociacion_id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const filePath = `${tipo_asociacion}/${safeId}/${timestamp}${ext}`;

        let uploaded;
        try {
            uploaded = await docStorage.uploadDocument(req.file, filePath);
        } catch (uploadError) {
            console.error('[Storage Upload Error]', uploadError);
            return res.status(500).json({
                message: `Error al subir archivo: ${uploadError.message}`,
                hint: uploadError.message.includes('WASABI') ? 'Verifica WASABI_ACCESS_KEY y WASABI_SECRET_KEY en Render → Environment.' : undefined
            });
        }

        const dbResult = await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, $3, $4::text, $5, $6) RETURNING *`,
            [nombreFinal, uploaded.url_storage, tipo_asociacion, String(asociacion_id), req.session.user?.id || null, uploaded.storage_path]
        );

        await insertarAuditoria(pool, {
            entidadId: String(asociacion_id),
            accion: 'SUBIR_DOCUMENTO',
            descripcion: `"${nombreFinal}" subido (${tipo_asociacion}).`,
            req
        });

        res.status(201).json(dbResult.rows[0]);
    } catch (e) {
        console.error('[Upload Documento Error]', e);
        res.status(500).json({ message: e.message || 'Error interno al guardar el documento.' });
    }
};

exports.getDocumentos = async (req, res) => {
    try {
        const { tipo_asociacion, asociacion_id } = req.query;
        if (!asociacion_id) return res.status(400).json({ message: 'asociacion_id es requerido.' });

        let query = `SELECT * FROM im_documentos WHERE asociacion_id::text=$1`;
        const params = [String(asociacion_id)];
        if (tipo_asociacion) { params.push(tipo_asociacion); query += ` AND tipo_asociacion=$2`; }
        query += ` ORDER BY creado_at DESC`;

        const result = await pool.query(query, params);

        const docs = await Promise.all(result.rows.map(async (doc) => ({
            ...doc,
            url_storage: await docStorage.signDocUrl(doc)
        })));

        res.json(docs);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getDocumentoUrl = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`SELECT * FROM im_documentos WHERE id=$1`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Documento no encontrado.' });
        const doc = result.rows[0];
        const url = await docStorage.signDocUrl(doc);
        res.json({ url, nombre: doc.nombre_personalizado, storage_path: doc.storage_path });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.renameDocumento = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre_personalizado } = req.body;
        if (!nombre_personalizado || !nombre_personalizado.trim())
            return res.status(400).json({ message: 'El nombre no puede estar vacío.' });

        const result = await pool.query(
            `UPDATE im_documentos SET nombre_personalizado=$1 WHERE id=$2 RETURNING *`,
            [nombre_personalizado.trim(), id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Documento no encontrado.' });

        await insertarAuditoria(pool, {
            entidadId: result.rows[0].asociacion_id,
            accion: 'RENOMBRAR_DOCUMENTO',
            descripcion: `Documento renombrado a "${nombre_personalizado.trim()}".`,
            req
        });

        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteDocumento = async (req, res) => {
    try {
        const { id } = req.params;
        const docRes = await pool.query(
            `DELETE FROM im_documentos WHERE id=$1 RETURNING nombre_personalizado, storage_path, url_storage, tipo_asociacion, asociacion_id`, [id]
        );
        if (docRes.rows.length === 0) return res.status(404).json({ message: 'Documento no encontrado.' });

        const doc = docRes.rows[0];
        await docStorage.deleteStoredDocument(doc);

        await insertarAuditoria(pool, {
            entidadId: doc.asociacion_id,
            accion: 'ELIMINAR_DOCUMENTO',
            descripcion: `"${doc.nombre_personalizado}" eliminado de ${doc.tipo_asociacion}.`,
            req
        });

        res.sendStatus(204);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
