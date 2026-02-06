/* controllers/pdfController.js */
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabaseClient'); 

// Configuración opcional para gráficos en Vercel (mejora rendimiento)
chromium.setGraphicsMode = false;

const loadCss = (filename) => {
    try {
        const filePath = path.join(__dirname, '../public/css', filename);
        if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
    } catch (e) { console.error("Error CSS:", e); }
    return ''; 
};

const sanitizeFilename = (name) => name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

exports.generatePropertyPDF = async (req, res) => {
    const { id } = req.params;
    const { type, cName, cRut } = req.query; 
    let browser = null;

    try {
        // ==========================================
        // 1. OBTENCIÓN DE DATOS
        // ==========================================
        const { data: prop, error } = await supabase
            .from('properties')
            .select('*, agent:users ( name, email, phone, photo_url )') 
            .eq('id', id)
            .single();

        if (error || !prop) return res.status(404).send("Propiedad no encontrada");

        // 2. PROCESAMIENTO DE IMÁGENES
        let safeImages = [];
        try {
            if (typeof prop.images === 'string') safeImages = JSON.parse(prop.images);
            else if (Array.isArray(prop.images)) safeImages = prop.images;
        } catch(e) {}
        
        const allImages = safeImages.map(img => (img && img.url) ? img.url : img).filter(u => typeof u === 'string');
        const mainImage = allImages.length > 0 ? allImages[0] : null;
        const subImages = allImages.length > 1 ? allImages.slice(1, 3) : []; 

        // 3. DATOS DEL AGENTE
        let contactInfo = {
            displayName: 'Cygnus Group Propiedades',
            role: 'Corredora de Propiedades',
            phone: '+56 9 2383 0830',
            email: 'contacto@cygnusgroup.cl',
            photo: null 
        };

        if (prop.agent && prop.agent.name) {
            contactInfo.displayName = prop.agent.name;
            contactInfo.role = 'Agente Inmobiliario';
            contactInfo.phone = prop.agent.phone || contactInfo.phone;
            contactInfo.email = prop.agent.email || contactInfo.email;
        }

        // 4. FORMATO DE DIRECCIÓN
        let addressDisplay = "";
        const region = prop.region || prop.address_region || '';
        const comuna = prop.address_commune || '';
        
        if (prop.show_exact_address) {
            addressDisplay = `${prop.address_street} #${prop.address_number}, ${comuna}`;
            if(region) addressDisplay += `, ${region}`;
        } else {
            addressDisplay = `${comuna}`;
            if(region) addressDisplay += `, ${region}`;
            addressDisplay += " (Ubicación Referencial)";
        }

        // 5. MAPA GOOGLE
        const gmapsKey = process.env.GOOGLE_MAPS_KEY || 'AIzaSyBeMVmY5lCw_TvvUBr6uZh8VrVlWHrU7lg'; 
        const lat = prop.latitude || -33.44889;
        const lng = prop.longitude || -70.669265;
        let mapStaticUrl = '';
        const mapSize = "600x350"; 
        const mapBase = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&size=${mapSize}&scale=2&maptype=roadmap&key=${gmapsKey}`;

        if (prop.show_exact_address) {
            mapStaticUrl = `${mapBase}&zoom=15&markers=color:red%7C${lat},${lng}`;
        } else {
            mapStaticUrl = `${mapBase}&zoom=14&markers=icon:http://chart.apis.google.com/chart?chst=d_map_pin_letter%26chld=%E2%80%A2|2563eb|${lat},${lng}`;
        }

        // 6. CARACTERÍSTICAS
        let featureGroups = {};
        let hasFeatures = false;
        try {
            if (prop.features && typeof prop.features === 'object') {
                Object.entries(prop.features).forEach(([groupKey, groupData]) => {
                    if (typeof groupData === 'object' && groupData !== null) {
                        let activeItems = [];
                        Object.entries(groupData).forEach(([key, val]) => {
                            if (val === true || val === 'on' || val === 1) {
                                let label = key.replace(/_/g, ' ');
                                label = label.charAt(0).toUpperCase() + label.slice(1);
                                activeItems.push(label);
                            }
                        });
                        if (activeItems.length > 0) {
                            let title = groupKey.replace(/_/g, ' ').replace(/features/i, '').trim();
                            featureGroups[title] = activeItems;
                            hasFeatures = true;
                        }
                    }
                });
            }
        } catch(e) {}

        // 7. PRECIOS
        const ufValue = req.app.locals.indicators ? req.app.locals.indicators.uf : 38000;
        const price = parseFloat(prop.price) || 0;
        const currency = prop.currency || 'UF';
        const fmtCLP = (v) => '$ ' + Number(v).toLocaleString('es-CL', { maximumFractionDigits: 0 });
        const fmtUF = (v) => 'UF ' + Number(v).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

        let priceMain, priceSecond;
        if (currency === 'UF') {
            priceMain = fmtUF(price);
            priceSecond = fmtCLP(price * ufValue);
        } else {
            priceMain = fmtCLP(price);
            priceSecond = fmtUF(price / ufValue);
        }

        // 8. RENDERIZADO HTML (EJS)
        const styles = `
            ${loadCss('theme.css')}
            @page { 
                size: Legal; 
                margin: 0;
                background-color: #ffffff; 
            }
            html, body { 
                -webkit-print-color-adjust: exact; 
                background-color: #ffffff !important; 
                margin: 0; padding: 0; 
            }
        `;

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const imgBase = `${protocol}://${host}`;

        const templateName = type === 'orden' ? 'pdf-visit-order' : 'pdf-brochure';
        const templatePath = path.join(__dirname, `../views/pdf/${templateName}.ejs`);
        
        const htmlContent = await ejs.renderFile(templatePath, {
            prop,
            cleanData: {
                mainImage, subImages, featureGroups, hasFeatures,
                priceMain, priceSecond, addressDisplay, contactInfo,
                mapUrl: mapStaticUrl,
                todayDate: new Date().toLocaleDateString('es-CL'),
                clientName: cName || '', clientRut: cRut || ''
            },
            css: styles, imgBase
        });

        // =========================================================
        // 9. CONFIGURACIÓN DE NAVEGADOR (CRÍTICO PARA VERCEL)
        // =========================================================
        
        // Detectamos si estamos en Producción (Vercel) o Local
        const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;

        if (isProduction) {
            // --- MODO VERCEL (Nube) ---
            // Usa el Chromium ligero especial para AWS Lambda/Vercel
            browser = await puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true
            });
        } else {
            // --- MODO LOCAL (Tu PC) ---
            // Usa tu Google Chrome instalado o el Puppeteer estándar
            browser = await puppeteer.launch({
                channel: 'chrome', // Intenta forzar el uso del Chrome instalado
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const page = await browser.newPage();
        
        // Aumentamos tiempo de espera a 60 segundos por si la red está lenta
        await page.setContent(htmlContent, { 
            waitUntil: ['load', 'networkidle0'], 
            timeout: 60000 
        });

        const pdfBuffer = await page.pdf({
            format: 'Legal', 
            printBackground: true,
            displayHeaderFooter: false 
        });

        const safeTitle = sanitizeFilename(prop.title).substring(0, 30);
        const fileName = type === 'orden' ? `Orden_${prop.id}.pdf` : `Ficha_${safeTitle}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.end(pdfBuffer);

    } catch (err) {
        console.error("PDF ERROR:", err);
        if (!res.headersSent) res.status(500).send("Error generando PDF: " + err.message);
    } finally {
        if (browser) await browser.close();
    }
};