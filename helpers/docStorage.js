const path = require('path');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');
const wasabi = require('./wasabiStorage');

require('dotenv').config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const SUPABASE_BUCKET = 'cygnus-documentos';
const CLOUDINARY_FOLDER = 'im-documentos';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.svg']);

let supabaseAdmin = null;

function getSupabaseAdmin() {
    if (supabaseAdmin) return supabaseAdmin;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) return null;
    supabaseAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return supabaseAdmin;
}

function isImageFile(file) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    return mime.startsWith('image/') || IMAGE_EXT.has(ext);
}

function parseStorageRef(storagePath) {
    if (!storagePath) return { backend: null, key: null };
    if (storagePath.startsWith('wasabi:')) return { backend: 'wasabi', key: storagePath.slice(7) };
    if (storagePath.startsWith('cloudinary:')) return { backend: 'cloudinary', key: storagePath.slice(11) };
    return { backend: 'supabase', key: storagePath };
}

function detectBackendFromDoc(doc) {
    const url = doc.url_storage || '';
    if (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')) {
        return { backend: 'cloudinary', key: doc.storage_path?.startsWith('cloudinary:') ? doc.storage_path.slice(11) : null };
    }
    if (url.includes('wasabisys.com')) {
        const ref = parseStorageRef(doc.storage_path);
        if (ref.backend === 'wasabi') return ref;
        const match = url.match(/wasabisys\.com\/[^/]+\/(.+?)(?:\?|$)/);
        return { backend: 'wasabi', key: match ? decodeURIComponent(match[1]) : null };
    }
    if (url.includes('supabase') || url.includes('/storage/v1/object/sign/')) {
        const ref = parseStorageRef(doc.storage_path);
        if (ref.backend === 'wasabi' || ref.backend === 'cloudinary') return ref;
        return { backend: 'supabase', key: resolveSupabasePath(doc) };
    }
    const ref = parseStorageRef(doc.storage_path);
    if (ref.backend) return ref;
    if (doc.storage_path && !doc.storage_path.startsWith('http')) {
        return { backend: 'wasabi', key: doc.storage_path };
    }
    return { backend: null, key: null };
}

function resolveSupabasePath(doc) {
    if (doc.storage_path && !doc.storage_path.startsWith('wasabi:') && !doc.storage_path.startsWith('cloudinary:')) {
        return doc.storage_path;
    }
    const url = doc.url_storage || '';
    if (!url.startsWith('http')) return url || null;
    const match = url.match(/\/cygnus-documentos\/(.+?)(?:\?|$)/);
    return match ? decodeURIComponent(match[1]) : null;
}

function uploadToCloudinaryBuffer(buffer, originalname) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: CLOUDINARY_FOLDER, resource_type: 'auto', use_filename: true, unique_filename: true },
            (err, result) => {
                if (err) return reject(err);
                resolve({
                    storage_path: `cloudinary:${result.public_id}`,
                    url_storage: result.secure_url
                });
            }
        );
        stream.end(buffer);
    });
}

async function uploadDocument(file, objectKey) {
    const contentType = file.mimetype || 'application/octet-stream';

    if (isImageFile(file)) {
        return uploadToCloudinaryBuffer(file.buffer, file.originalname);
    }

    // PDFs y demás documentos → solo Wasabi (nunca Supabase)
    const key = objectKey;
    await wasabi.uploadObject(key, file.buffer, contentType);
    let url_storage = key;
    try {
        url_storage = await wasabi.getSignedObjectUrl(key, 60 * 60 * 24 * 365);
    } catch (_) {}

    return {
        storage_path: `wasabi:${key}`,
        url_storage
    };
}

async function signDocUrl(doc) {
    const url = doc.url_storage || '';

    if (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')) {
        return url;
    }

    const { backend, key } = detectBackendFromDoc(doc);

    if (backend === 'cloudinary') {
        if (key) return cloudinary.url(key, { secure: true, resource_type: 'auto' });
        return url;
    }

    if (backend === 'wasabi' && key) {
        try {
            return await wasabi.getSignedObjectUrl(key, 3600);
        } catch (e) {
            console.warn('[Wasabi Sign URL]', key, e.message);
            return url;
        }
    }

    if (backend === 'supabase' && key) {
        const client = getSupabaseAdmin();
        if (!client) return url;
        try {
            const { data, error } = await client.storage
                .from(SUPABASE_BUCKET).createSignedUrl(key, 3600);
            if (error) {
                console.warn('[Supabase Sign URL]', key, error.message);
                return url;
            }
            return data?.signedUrl || url;
        } catch (e) {
            console.warn('[Supabase Sign URL exception]', key, e.message);
            return url;
        }
    }

    return url;
}

async function deleteStoredDocument(doc) {
    const { backend, key } = detectBackendFromDoc(doc);
    if (!key && !doc.storage_path) return;

    try {
        if (backend === 'cloudinary') {
            const publicId = key || (doc.storage_path?.startsWith('cloudinary:') ? doc.storage_path.slice(11) : null);
            if (publicId) await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'auto' });
            return;
        }
        if (backend === 'wasabi' && key) {
            await wasabi.deleteObject(key);
            return;
        }
        if (backend === 'supabase' && key) {
            const client = getSupabaseAdmin();
            if (client) await client.storage.from(SUPABASE_BUCKET).remove([key]);
        }
    } catch (e) {
        console.warn('[Delete storage]', doc.storage_path, e.message);
    }
}

async function testStorage() {
    const wasabiResult = await wasabi.testConnection();
    let cloudinaryOk = false;
    try {
        cloudinaryOk = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY);
    } catch (_) {}

    let supabaseOk = false;
    try {
        const client = getSupabaseAdmin();
        if (client) {
            const { data, error } = await client.storage.listBuckets();
            supabaseOk = !error && !!(data || []).find(b => b.id === SUPABASE_BUCKET);
        }
    } catch (_) {}

    return {
        wasabi: wasabiResult,
        cloudinary: { ok: cloudinaryOk },
        supabase_legacy: { ok: supabaseOk, bucket: SUPABASE_BUCKET }
    };
}

module.exports = {
    isImageFile,
    uploadDocument,
    signDocUrl,
    deleteStoredDocument,
    testStorage,
    resolveSupabasePath
};
