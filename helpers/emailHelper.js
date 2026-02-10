const nodemailer = require('nodemailer');

// Detectamos si usamos puerto seguro (465) o estándar (587)
const isSecure = process.env.SMTP_PORT == 465;

// Configuración del transporte (El Cartero)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: isSecure, // true para 465, false para otros
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    // Configuraciones avanzadas para evitar errores de red en servidores corporativos
    tls: {
        rejectUnauthorized: false, // Ayuda si el certificado SSL del servidor no es perfecto
        ciphers: 'SSLv3'
    },
    // Aumentamos el tiempo de espera para conexiones lentas
    connectionTimeout: 10000, // 10 segundos
    greetingTimeout: 10000,
    socketTimeout: 10000
});

// Verificamos la conexión al iniciar la app (para depurar)
transporter.verify(function (error, success) {
    if (error) {
        console.log("❌ Error conectando al servidor de correo:", error.message);
    } else {
        console.log("✅ Servidor de correo listo para enviar mensajes.");
    }
});

const sendEmail = async (to, subject, htmlContent) => {
    try {
        console.log(`📨 Intentando enviar correo a: ${to} usando puerto ${process.env.SMTP_PORT}...`);
        
        const info = await transporter.sendMail({
            from: `"Soporte Cygnus Group" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });

        console.log("✅ Correo enviado con éxito. ID:", info.messageId);
        return true;
    } catch (error) {
        console.error("❌ Error enviando correo:", error);
        return false;
    }
};

module.exports = sendEmail;