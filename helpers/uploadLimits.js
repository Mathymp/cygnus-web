/** Límites de subida compartidos (servidor + mensajes). */
const MB = 1024 * 1024;

const MAX_IMAGE_BYTES = 20 * MB;
const MAX_DOC_BYTES = 100 * MB;
const MAX_PANO_BYTES = 200 * MB;

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif']);
const IMAGE_MIMES = /^image\//i;

function isImageFile(file = {}) {
    const mime = file.mimetype || file.type || '';
    if (IMAGE_MIMES.test(mime)) return true;
    const name = (file.originalname || file.name || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    if (dot >= 0) return IMAGE_EXTS.has(name.slice(dot));
    return false;
}

function fmtBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / MB).toFixed(1)} MB`;
}

function maxForFile(file) {
    return isImageFile(file) ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
}

function kindLabel(file) {
    return isImageFile(file) ? 'imágenes' : 'PDF y documentos';
}

/** @returns {string|null} mensaje de error o null si OK */
function checkFileSize(file) {
    if (!file) return null;
    const max = maxForFile(file);
    const size = Number(file.size) || 0;
    if (size <= max) return null;
    const name = file.originalname || file.name || 'Archivo';
    return `${name} pesa ${fmtBytes(size)} y supera el máximo de ${fmtBytes(max)} para ${kindLabel(file)}.`;
}

function sizeLimitMessage(fileHint) {
    // Multer LIMIT_FILE_SIZE no trae el archivo; mensaje genérico con ambos topes
    if (fileHint && (fileHint.mimetype || fileHint.type || fileHint.originalname || fileHint.name)) {
        const max = maxForFile(fileHint);
        return `El archivo es demasiado pesado. Pesa más de ${fmtBytes(max)} (máximo para ${kindLabel(fileHint)}). Imágenes: ${fmtBytes(MAX_IMAGE_BYTES)} · PDF/docs: ${fmtBytes(MAX_DOC_BYTES)}.`;
    }
    return `El archivo es demasiado pesado. Máximos: imágenes ${fmtBytes(MAX_IMAGE_BYTES)} · PDF y documentos ${fmtBytes(MAX_DOC_BYTES)}.`;
}

module.exports = {
    MB,
    MAX_IMAGE_BYTES,
    MAX_DOC_BYTES,
    MAX_PANO_BYTES,
    isImageFile,
    fmtBytes,
    maxForFile,
    kindLabel,
    checkFileSize,
    sizeLimitMessage
};
