const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'propiedades',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        resource_type: 'auto',
        // Transformación segura: Redimensionar en Cloudinary si algo gigante pasa
        transformation: [{ width: 1920, crop: "limit", quality: "auto" }] 
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        // 1. Límite por archivo individual (Imágenes) - 100MB
        fileSize: 100 * 1024 * 1024, 
        
        // 2. IMPORTANTE: Límite para campos de texto (Descripción/Quill) - 50MB
        // Sin esto, si la descripción es larga o tiene base64, explota con error 413.
        fieldSize: 50 * 1024 * 1024,

        // 3. Límite de partes (Headers + Files + Fields)
        parts: Infinity
    }
});

module.exports = upload;