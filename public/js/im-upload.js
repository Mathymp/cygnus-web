/**
 * Validación de peso y helpers de subida multiarchivo (IM).
 * Límites alineados con helpers/uploadLimits.js
 */
(function (global) {
    var MB = 1024 * 1024;
    var MAX_IMAGE_BYTES = 20 * MB;
    var MAX_DOC_BYTES = 100 * MB;

    function fmtBytes(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < MB) return (n / 1024).toFixed(1) + ' KB';
        return (n / MB).toFixed(1) + ' MB';
    }

    function isImageFile(file) {
        if (!file) return false;
        if (file.type && /^image\//i.test(file.type)) return true;
        var name = String(file.name || '').toLowerCase();
        return /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(name);
    }

    function maxForFile(file) {
        return isImageFile(file) ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
    }

    function kindLabel(file) {
        return isImageFile(file) ? 'imágenes' : 'PDF y documentos';
    }

    /** @returns {string|null} */
    function validateFile(file) {
        if (!file) return null;
        var max = maxForFile(file);
        if ((file.size || 0) <= max) return null;
        return (file.name || 'Archivo') + ' pesa ' + fmtBytes(file.size) +
            ' y supera el máximo de ' + fmtBytes(max) + ' para ' + kindLabel(file) + '.';
    }

    /** @returns {string[]} errores */
    function validateFiles(files) {
        var list = Array.from(files || []);
        var errs = [];
        for (var i = 0; i < list.length; i++) {
            var e = validateFile(list[i]);
            if (e) errs.push(e);
        }
        return errs;
    }

    function assertFilesOk(files) {
        var errs = validateFiles(files);
        if (errs.length) throw new Error(errs.join('\n'));
        return Array.from(files || []);
    }

    function hintText() {
        return 'Varios archivos · imágenes máx. ' + fmtBytes(MAX_IMAGE_BYTES) +
            ' · PDF/docs máx. ' + fmtBytes(MAX_DOC_BYTES);
    }

    async function readErrorMessage(res, fallback) {
        var body = {};
        try { body = await res.clone().json(); } catch (_) {
            try { body = await res.json(); } catch (__) {}
        }
        return body.message || body.error || fallback || ('Error HTTP ' + res.status);
    }

    /**
     * Sube varios archivos de a uno con FormData builder.
     * buildFd(file, index) => FormData
     */
    async function uploadEach(files, buildFd, url, options) {
        var opts = options || {};
        var list = assertFilesOk(files);
        var results = [];
        for (var i = 0; i < list.length; i++) {
            var fd = buildFd(list[i], i);
            var res = await fetch(url, { method: opts.method || 'POST', body: fd });
            if (!res.ok) throw new Error(await readErrorMessage(res));
            try { results.push(await res.json()); } catch (_) { results.push(null); }
        }
        return results;
    }

    global.IMUpload = {
        MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
        MAX_DOC_BYTES: MAX_DOC_BYTES,
        fmtBytes: fmtBytes,
        isImageFile: isImageFile,
        maxForFile: maxForFile,
        validateFile: validateFile,
        validateFiles: validateFiles,
        assertFilesOk: assertFilesOk,
        hintText: hintText,
        readErrorMessage: readErrorMessage,
        uploadEach: uploadEach
    };
})(typeof window !== 'undefined' ? window : this);
