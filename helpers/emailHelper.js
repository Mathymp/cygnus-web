// helpers/emailHelper.js
const sendEmail = async (to, subject, title, messageHtml, buttonText = null, buttonLink = null) => {
    
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = 'contacto@cygnusgroup.cl'; // Tu dominio verificado

    // --- PLANTILLA MAESTRA "CYGNUS CORPORATE" ---
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #334155; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 35px; text-align: center; }
            .logo { color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: 1px; margin: 0; }
            .content { padding: 40px; line-height: 1.6; font-size: 16px; }
            .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 14px 30px; text-decoration: none; border-radius: 50px; font-weight: 600; margin-top: 25px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25); }
            .footer { background-color: #f1f5f9; padding: 25px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 class="logo">CYGNUS GROUP</h1>
            </div>
            <div class="content">
                <h2 style="color:#1e293b; margin-top:0;">${title}</h2>
                <div style="color:#475569;">
                    ${messageHtml}
                </div>
                
                ${buttonText && buttonLink ? `
                <div style="text-align: center;">
                    <a href="${buttonLink}" class="btn">${buttonText}</a>
                </div>
                ` : ''}

                <p style="margin-top: 30px; font-size: 14px; color: #94a3b8; border-top: 1px solid #eee; padding-top: 20px;">
                    Si no solicitaste esta acción, puedes ignorar este correo.
                </p>
            </div>
            <div class="footer">
                <p>&copy; 2026 Cygnus Group Propiedades.</p>
                <p>Sistema de Gestión Inmobiliaria</p>
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
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                from: `Soporte Cygnus <${fromEmail}>`,
                to: [to],
                subject: subject,
                html: htmlTemplate
            })
        });

        if (response.ok) {
            console.log(`✅ Correo enviado a ${to}`);
            return true;
        } else {
            console.error("❌ Error Resend:", await response.json());
            return false;
        }
    } catch (error) {
        console.error("❌ Error de red:", error);
        return false;
    }
};

module.exports = sendEmail;