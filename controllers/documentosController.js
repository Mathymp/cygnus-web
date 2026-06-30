const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Cliente de Supabase con Service Role para poder escribir en Storage
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const BUCKET = 'cygnus-documentos';

async function insertarAuditoria(pool, { entidadId, accion, descripcion, req }) {
    const userId = req.session.user ? req.session.user.id : null;
    const userName = req.session.user ? req.session.user.name : 'Sistema';
    try {
        await pool.query(
            `INSERT INTO im_auditoria (tabla_afectada, entidad_id, accion, descripcion, usuario_id, usuario_nombre)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            ['im_documentos', entidadId || null, accion, descripcion, userId, userName]
        );
    } catch (_) { /* No bloquear */ }
}

exports.uploadDocumento = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });

        const { nombre_personalizado, tipo_asociacion, asociacion_id } = req.body;
        if (!nombre_personalizado || !tipo_asociacion || !asociacion_id) {
            return res.status(400).json({ message: 'Faltan campos: nombre_personalizado, tipo_asociacion, asociacion_id.' });
        }

        const tiposValidos = ['proyecto', 'parcela', 'persona'];
        if (!tiposValidos.includes(tipo_asociacion)) {
            return res.status(400).json({ message: `tipo_asociacion debe ser uno de: ${tiposValidos.join(', ')}` });
        }

        // Generar ruta única en el bucket
        const ext = path.extname(req.file.originalname).toLowerCase();
        const timestamp = Date.now();
        const filePath = `${tipo_asociacion}/${asociacion_id}/${timestamp}${ext}`;

        // Subir al bucket de Supabase Storage
        const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('Error Supabase Storage:', uploadError);
            return res.status(500).json({ message: 'Error al subir el archivo al Storage.', detail: uploadError.message });
        }

        // Generar URL firmada con vigencia de 1 año (en segundos)
        const { data: signedData } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(filePath, 60 * 60 * 24 * 365);

        const url_storage = signedData ? signedData.signedUrl : filePath;

        // Registrar metadata en la BD
        const dbResult = await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, req.session.user.id, filePath]
        );

        // Auditoría
        await insertarAuditoria(pool, {
            entidadId: asociacion_id,
            accion: 'SUBIR_DOCUMENTO',
            descripcion: `Documento "${nombre_personalizado}" subido para ${tipo_asociacion} ${asociacion_id}.`,
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

        let query = `SELECT * FROM im_documentos WHERE asociacion_id = $1`;
        const params = [asociacion_id];

        if (tipo_asociacion) {
            params.push(tipo_asociacion);
            query += ` AND tipo_asociacion = $2`;
        }
        query += ` ORDER BY creado_at DESC`;

        const result = await pool.query(query, params);

        // Regenerar URLs firmadas frescas para cada documento
        const documentosConUrl = await Promise.all(result.rows.map(async (doc) => {
            if (doc.storage_path) {
                try {
                    const { data } = await supabaseAdmin.storage
                        .from(BUCKET)
                        .createSignedUrl(doc.storage_path, 3600); // 1 hora
                    return { ...doc, url_storage: data ? data.signedUrl : doc.url_storage };
                } catch (_) { return doc; }
            }
            return doc;
        }));

        res.json(documentosConUrl);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteDocumento = async (req, res) => {
    try {
        const { id } = req.params;
        const docRes = await pool.query(
            `DELETE FROM im_documentos WHERE id=$1 RETURNING nombre_personalizado, storage_path, tipo_asociacion, asociacion_id`,
            [id]
        );
        if (docRes.rows.length === 0) return res.status(404).json({ message: 'Documento no encontrado.' });

        const doc = docRes.rows[0];

        // Eliminar del bucket de Supabase Storage
        if (doc.storage_path) {
            await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);
        }

        // Auditoría
        await insertarAuditoria(pool, {
            entidadId: doc.asociacion_id,
            accion: 'ELIMINAR_DOCUMENTO',
            descripcion: `Documento "${doc.nombre_personalizado}" eliminado de ${doc.tipo_asociacion}.`,
            req
        });

        res.sendStatus(204);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
