// helpers/emailHelper.js
const sendEmail = async (to, subject, title, message, buttonText = null, buttonLink = null) => {
    
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = 'contacto@cygnusgroup.cl'; // Tu dominio verificado

    // --- PLANTILLA CORPORATIVA "CYGNUS BLUE" ---
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1f5f9; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 30px; text-align: center; }
            .content { padding: 40px; color: #334155; line-height: 1.6; }
            .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; text-align: center; }
            .footer { background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="color:white; margin:0; font-size:24px;">CYGNUS GROUP</h1>
            </div>
            <div class="content">
                <h2 style="color:#1e293b; margin-top:0;">${title}</h2>
                <div style="font-size:16px;">${message}</div>
                
                ${buttonText && buttonLink ? `
                <div style="text-align:center; margin: 30px 0;">
                    <a href="${buttonLink}" class="btn">${buttonText}</a>
                </div>
                ` : ''}
                
                <p style="margin-top:30px; font-size:14px; color:#64748b;">
                    Si tienes dudas, responde a este correo.
                </p>
            </div>
            <div class="footer">
                <p>&copy; 2026 Cygnus Group Propiedades. Todos los derechos reservados.</p>
                <p>Este correo fue enviado automáticamente, por favor no lo marques como spam.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    if (!apiKey) {
        console.error("❌ ERROR: Falta RESEND_API_KEY en .env");
        return false;
    }

    try {
        console.log(`📨 Enviando a: ${to}...`);
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                from: `Cygnus Group <${fromEmail}>`,
                to: [to],
                subject: subject,
                html: htmlTemplate
            })
        });

        const data = await response.json();
        if (response.ok) {
            console.log("✅ Correo enviado ID:", data.id);
            return true;
        } else {
            console.error("❌ Error Resend:", data);
            return false;
        }
    } catch (error) {
        console.error("❌ Error Red:", error);
        return false;
    }
};

module.exports = sendEmail;