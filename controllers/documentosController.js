const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const BUCKET = 'cygnus-documentos';

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

exports.uploadDocumento = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });

        const { nombre_personalizado, tipo_asociacion, asociacion_id } = req.body;
        if (!tipo_asociacion || !asociacion_id)
            return res.status(400).json({ message: 'Faltan campos: tipo_asociacion, asociacion_id.' });

        const tiposValidos = ['proyecto', 'parcela', 'persona', 'venta'];
        if (!tiposValidos.includes(tipo_asociacion))
            return res.status(400).json({ message: `tipo_asociacion debe ser: ${tiposValidos.join(', ')}` });

        const nombreFinal = (nombre_personalizado && nombre_personalizado.trim())
            ? nombre_personalizado.trim()
            : req.file.originalname.replace(/\.[^/.]+$/, '');

        const ext = path.extname(req.file.originalname).toLowerCase();
        const timestamp = Date.now();
        const filePath = `${tipo_asociacion}/${asociacion_id}/${timestamp}${ext}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

        if (uploadError) {
            console.error('Error Supabase Storage:', uploadError);
            return res.status(500).json({ message: 'Error al subir al Storage.', detail: uploadError.message });
        }

        // URL pública si el bucket es público, o firmada si es privado
        let url_storage = filePath;
        try {
            const { data: signedData } = await supabaseAdmin.storage
                .from(BUCKET)
                .createSignedUrl(filePath, 60 * 60 * 24 * 365);
            if (signedData) url_storage = signedData.signedUrl;
        } catch (_) {}

        const dbResult = await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombreFinal, url_storage, tipo_asociacion, asociacion_id, req.session.user.id, filePath]
        );

        await insertarAuditoria(pool, {
            entidadId: asociacion_id,
            accion: 'SUBIR_DOCUMENTO',
            descripcion: `"${nombreFinal}" subido (${tipo_asociacion}).`,
            req
        });

        res.status(201).json(dbResult.rows[0]);
    } catch (e) {
        console.error('Error uploadDocumento:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.getDocumentos = async (req, res) => {
    try {
        const { tipo_asociacion, asociacion_id } = req.query;
        if (!asociacion_id) return res.status(400).json({ message: 'asociacion_id es requerido.' });

        let query = `SELECT * FROM im_documentos WHERE asociacion_id=$1`;
        const params = [asociacion_id];
        if (tipo_asociacion) { params.push(tipo_asociacion); query += ` AND tipo_asociacion=$2`; }
        query += ` ORDER BY creado_at DESC`;

        const result = await pool.query(query, params);

        // Regenerar URLs firmadas frescas (válidas 1 hora)
        const docs = await Promise.all(result.rows.map(async (doc) => {
            if (doc.storage_path) {
                try {
                    const { data } = await supabaseAdmin.storage
                        .from(BUCKET).createSignedUrl(doc.storage_path, 3600);
                    return { ...doc, url_storage: data ? data.signedUrl : doc.url_storage };
                } catch (_) {}
            }
            return doc;
        }));

        res.json(docs);
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
