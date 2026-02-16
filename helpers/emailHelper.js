// helpers/emailHelper.js
const sendEmail = async (to, subject, title, messageHtml, buttonText = null, buttonLink = null) => {
    
    const apiKey = process.env.RESEND_API_KEY;
    
    // Configuración del remitente (Debe coincidir con tu dominio verificado)
    const fromEmail = 'contacto@cygnusgroup.cl'; 

    // IMPORTANTE: URL absoluta del logo (Asegúrate que esta imagen exista y cargue rápido)
    const logoUrl = 'https://www.cygnusgroup.cl/img/logo.png'; 

    // --- 1. GENERAR VERSIÓN TEXTO PLANO (CRÍTICO PARA ANTI-SPAM) ---
    // Los filtros de correo revisan esto primero. Si no existe, es bandera roja.
    let textVersion = `${title.toUpperCase()}\n\n`;
    // Eliminamos etiquetas HTML para dejar solo el texto limpio
    textVersion += messageHtml.replace(/<[^>]*>?/gm, ''); 
    
    if (buttonText && buttonLink) {
        textVersion += `\n\n--------------------------------------------------\n`;
        textVersion += `${buttonText}: ${buttonLink}`;
        textVersion += `\n--------------------------------------------------\n`;
    }
    
    textVersion += `\n\n© 2026 Cygnus Group Propiedades.\nEste es un mensaje automático, por favor no responder directamente si no es necesario.`;


    // --- 2. DISEÑO "CLEAN TECH" (Tu estilo original Netflix / Airbnb) ---
    const htmlTemplate = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
            /* Reset y Fuentes */
            body { 
                margin: 0; 
                padding: 0; 
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
                background-color: #f4f4f5; 
                color: #334155; 
                -webkit-font-smoothing: antialiased; 
            }
            
            /* Contenedor Principal (Fondo Gris Claro) */
            .email-wrapper { 
                width: 100%; 
                padding: 60px 0; 
                background-color: #f4f4f5; 
            }
            
            /* Tarjeta Central (Blanca y Flotante) */
            .email-card { 
                max-width: 480px; 
                margin: 0 auto; 
                background: #ffffff; 
                border-radius: 16px; 
                box-shadow: 0 4px 24px rgba(0,0,0,0.06); 
                overflow: hidden; 
                border: 1px solid #e4e4e7; 
            }
            
            /* CABECERA BLANCA (Para que el logo azul RESALTE) */
            .header { 
                background-color: #ffffff; 
                padding: 40px 0 20px; 
                text-align: center; 
                border-bottom: 1px solid #f4f4f5; /* Línea sutil */
            }
            .header img { 
                height: 48px; /* Tamaño generoso */
                width: auto; 
                display: block; 
                margin: 0 auto; 
                border: 0;
            }
            
            /* CUERPO */
            .content { 
                padding: 40px 40px 50px; 
                text-align: center; 
            }
            
            /* Título Grande y Limpio */
            .h1-title { 
                margin: 0 0 20px; 
                font-size: 26px; 
                font-weight: 700; 
                color: #0f172a; 
                letter-spacing: -0.5px; 
            }
            
            /* Texto legible */
            .text-body { 
                font-size: 16px; 
                line-height: 1.6; 
                color: #52525b; 
                margin-bottom: 30px; 
            }
            
            /* BOTÓN GRANDE (Estilo App) */
            .btn-container { margin: 35px 0; }
            .btn { 
                display: block; 
                width: 100%; 
                background-color: #2563eb; /* Tu azul corporativo */
                color: #ffffff !important; 
                padding: 18px 0; 
                text-decoration: none; 
                border-radius: 12px; 
                font-weight: 600; 
                font-size: 16px; 
                text-align: center; 
                box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
                transition: background 0.2s; 
            }
            .btn:hover { background-color: #1d4ed8; }
            
            /* Link Secundario (Por si el botón falla) */
            .secondary-link {
                display: block;
                margin-top: 25px;
                font-size: 13px;
                color: #94a3b8;
                word-break: break-all;
                line-height: 1.5;
            }
            .secondary-link a { color: #2563eb; text-decoration: none; }

            /* FOOTER MINIMALISTA */
            .footer { 
                background-color: #fafafa; 
                padding: 25px; 
                text-align: center; 
                font-size: 12px; 
                color: #a1a1aa; 
                border-top: 1px solid #f4f4f5; 
            }
        </style>
    </head>
    <body>
        <div class="email-wrapper">
            <div class="email-card">
                
                <div class="header">
                    <img src="${logoUrl}" alt="Cygnus Group" onerror="this.style.display='none'">
                </div>
                
                <div class="content">
                    <h1 class="h1-title">${title}</h1>
                    
                    <div class="text-body">
                        ${messageHtml}
                    </div>
                    
                    ${buttonText && buttonLink ? `
                    <div class="btn-container">
                        <a href="${buttonLink}" class="btn">${buttonText}</a>
                    </div>
                    
                    <div class="secondary-link">
                        Si el botón no funciona, copia este enlace:<br>
                        <a href="${buttonLink}">${buttonLink}</a>
                    </div>
                    ` : ''}
                </div>

                <div class="footer">
                    <p>&copy; 2026 Cygnus Group Propiedades</p>
                    <p>Este es un mensaje de seguridad automático.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    // --- 3. VALIDACIÓN Y ENVÍO ---
    if (!apiKey) {
        console.error("❌ ERROR CRÍTICO: Falta RESEND_API_KEY en el archivo .env");
        return false;
    }

    try {
        const payload = {
            from: `Cygnus Group <${fromEmail}>`, // Nombre + Email para mejor presentación
            to: [to],
            subject: subject,
            html: htmlTemplate,
            text: textVersion, // IMPORTANTE: Versión texto plano para filtros anti-spam
            tags: [
                { name: 'category', value: 'transactional' } // Categoría ayuda a reputación
            ]
        };

        // Manejo especial para "Responder a" si es un formulario de contacto
        if (buttonLink && buttonLink.startsWith('mailto:')) {
            const replyEmail = buttonLink.replace('mailto:', '');
            payload.reply_to = replyEmail;
        }

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            return true;
        } else {
            const errorData = await response.json();
            console.error("❌ Error devuelto por Resend:", errorData);
            return false;
        }
    } catch (error) {
        console.error("❌ Error de red al enviar correo:", error);
        return false;
    }
};

module.exports = sendEmail;