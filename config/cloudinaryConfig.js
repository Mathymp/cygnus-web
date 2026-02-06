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
        // resource_type: 'auto' permite que Cloudinary detecte el tipo y optimice la recepción
        resource_type: 'auto',
        // Opcional: Esto asegura que Cloudinary no guarde imagenes innecesariamente gigantes
        // Las redimensiona a un máximo de 1920px de ancho si son mayores
        transformation: [{ width: 1920, crop: "limit", quality: "auto" }] 
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB por archivo (límite de seguridad)
        files: 10 // Máximo 10 fotos por subida para proteger la RAM
    }
});

module.exports = upload;