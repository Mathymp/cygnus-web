const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const SUPABASE_ADMIN_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_KEY;

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    SUPABASE_ADMIN_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

const BUCKET = 'cygnus-documentos';

function resolveStoragePath(doc) {
    if (doc.storage_path) return doc.storage_path;
    const url = doc.url_storage || '';
    if (!url.startsWith('http')) return url || null;
    const match = url.match(/\/cygnus-documentos\/(.+?)(?:\?|$)/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function signDocUrl(doc) {
    const storagePath = resolveStoragePath(doc);
    if (!storagePath) return doc.url_storage;
    try {
        const { data, error } = await supabaseAdmin.storage
            .from(BUCKET).createSignedUrl(storagePath, 3600);
        if (error) {
            console.warn('[Sign URL]', storagePath, error.message);
            return doc.url_storage;
        }
        return data?.signedUrl || doc.url_storage;
    } catch (e) {
        console.warn('[Sign URL exception]', storagePath, e.message);
        return doc.url_storage;
    }
}

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
        const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
        if (error) return res.json({ ok: false, error: error.message, key_type: SUPABASE_ADMIN_KEY?.length > 100 ? 'service_role (largo)' : 'anon/short' });
        const bucket = (buckets || []).find(b => b.id === BUCKET);
        res.json({ ok: true, bucket_found: !!bucket, bucket_name: BUCKET, key_type: SUPABASE_ADMIN_KEY?.length > 100 ? 'service_role (largo)' : 'anon o corta' });
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

        const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(filePath, req.file.buffer, { contentType: req.file.mimetype || 'application/octet-stream', upsert: false });

        if (uploadError) {
            console.error('[Storage Upload Error]', uploadError);
            return res.status(500).json({
                message: `Error al subir archivo al Storage: ${uploadError.message}`,
                hint: uploadError.statusCode === 403 ? 'Verifica que SUPABASE_SERVICE_ROLE_KEY esté configurado en Render.' : undefined
            });
        }

        let url_storage = filePath;
        try {
            const { data: signedData, error: signErr } = await supabaseAdmin.storage
                .from(BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 365);
            if (signedData?.signedUrl) url_storage = signedData.signedUrl;
            else if (signErr) console.warn('[Sign URL warn]', signErr.message);
        } catch (_) {}

        const dbResult = await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, $3, $4::text, $5, $6) RETURNING *`,
            [nombreFinal, url_storage, tipo_asociacion, String(asociacion_id), req.session.user?.id || null, filePath]
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

        // Regenerar URLs firmadas frescas (válidas 1 hora)
        const docs = await Promise.all(result.rows.map(async (doc) => ({
            ...doc,
            url_storage: await signDocUrl(doc)
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
        const url = await signDocUrl(doc);
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
            `DELETE FROM im_documentos WHERE id=$1 RETURNING nombre_personalizado, storage_path, tipo_asociacion, asociacion_id`, [id]
        );
        if (docRes.rows.length === 0) return res.status(404).json({ message: 'Documento no encontrado.' });

        const doc = docRes.rows[0];
        if (doc.storage_path) {
            await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);
        }

        await insertarAuditoria(pool, {
            entidadId: doc.asociacion_id,
            accion: 'ELIMINAR_DOCUMENTO',
            descripcion: `"${doc.nombre_personalizado}" eliminado de ${doc.tipo_asociacion}.`,
            req
        });

        res.sendStatus(204);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
