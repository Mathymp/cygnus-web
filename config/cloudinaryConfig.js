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
        // Mantenemos esta transformación de seguridad por si acaso
        transformation: [{ width: 1920, crop: "limit", quality: "auto" }] 
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        // Aumentamos el límite individual a 50MB (antes 10MB)
        fileSize: 50 * 1024 * 1024, 
        // ¡ELIMINADO EL LÍMITE DE CANTIDAD! 
        // Ahora puedes subir las que quieras (files: Infinity por defecto)
    }
});

module.exports = upload;