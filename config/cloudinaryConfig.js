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
        folder: 'cygnus_propiedades',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        // Cloudinary aceptará el archivo tal cual venga
        resource_type: 'auto' 
    }
});

// CORRECCIÓN: Aumentado a 50MB para coincidir con app.js y evitar el error "File too large"
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB por archivo
});

module.exports = upload;