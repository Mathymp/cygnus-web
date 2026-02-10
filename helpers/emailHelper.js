// helpers/emailHelper.js
const sendEmail = async (to, subject, title, messageHtml, buttonText = null, buttonLink = null) => {
    
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = 'contacto@cygnusgroup.cl'; // Tu dominio verificado

    // URL ABSOLUTA DEL LOGO (Vital para que se vea en Gmail/Outlook)
    const logoUrl = 'https://www.cygnusgroup.cl/img/logo.png'; 

    // --- DISEÑO CORPORATIVO PREMIUM "CYGNUS PRO" ---
    const htmlTemplate = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #334155; }
            .email-wrapper { width: 100%; background-color: #f1f5f9; padding: 40px 0; }
            .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08); }
            
            /* Cabecera con Fondo Azul Profundo */
            .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 40px 20px; text-align: center; }
            .header img { max-height: 50px; width: auto; display: block; margin: 0 auto; }
            .header h1 { color: #ffffff; margin: 15px 0 0 0; font-size: 24px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; }
            
            /* Contenido */
            .content { padding: 40px; line-height: 1.8; font-size: 16px; color: #475569; }
            .content h2 { color: #1e293b; margin-top: 0; font-size: 22px; font-weight: 700; margin-bottom: 20px; }
            .content p { margin-bottom: 20px; }
            
            /* Botón Premium */
            .btn-container { text-align: center; margin: 35px 0; }
            .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2); transition: background-color 0.3s; }
            .btn:hover { background-color: #1d4ed8; }
            
            /* Footer */
            .footer { background-color: #f8fafc; padding: 30px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
            .footer a { color: #64748b; text-decoration: underline; }
        </style>
    </head>
    <body>
        <div class="email-wrapper">
            <div class="email-container">
                <div class="header">
                    <img src="${logoUrl}" alt="Cygnus Group" onerror="this.style.display='none'">
                    ${!logoUrl ? '<h1>CYGNUS GROUP</h1>' : ''} 
                </div>
                
                <div class="content">
                    <h2>${title}</h2>
                    <div>
                        ${messageHtml}
                    </div>
                    
                    ${buttonText && buttonLink ? `
                    <div class="btn-container">
                        <a href="${buttonLink}" class="btn">${buttonText}</a>
                    </div>
                    <p style="font-size: 14px; text-align: center; color: #94a3b8;">
                        Si el botón no funciona, copia y pega este enlace:<br>
                        <a href="${buttonLink}" style="color:#2563eb; word-break:break-all;">${buttonLink}</a>
                    </p>
                    ` : ''}

                    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
                        <p style="margin: 0; font-size: 14px;">Atentamente,<br><strong>El equipo de Cygnus Group</strong></p>
                    </div>
                </div>

                <div class="footer">
                    <p>&copy; 2026 Cygnus Group Propiedades. Todos los derechos reservados.</p>
                    <p>Este es un mensaje automático de seguridad. Por favor no respondas a este correo.</p>
                    <p>Concepción, Chile.</p>
                </div>
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
                from: `Cygnus Seguridad <${fromEmail}>`,
                to: [to],
                subject: subject,
                html: htmlTemplate
            })
        });

        if (response.ok) {
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