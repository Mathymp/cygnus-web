const supabase = require('../config/supabaseClient');
const cloudinary = require('../config/cloudinaryConfig');
const fs = require('fs');
// Importamos tu helper de emails (Resend) en lugar de nodemailer
const sendEmail = require('../helpers/emailHelper'); 

const mainController = {
    // 1. HOME (Landing Page)
    home: async (req, res) => {
        try {
            // Cargar Config básica
            let config = { banners: [] };
            const { data: configData } = await supabase.from('site_config').select('*').limit(1).single();
            if(configData) config = configData;

            // Traer 12 propiedades (incluyendo vendidas/reservadas para rellenar)
            let { data: featuredProps } = await supabase.from('properties')
                .select('*')
                .in('status', ['publicado', 'reservado', 'vendido', 'arrendado']) 
                .order('created_at', { ascending: false })
                .limit(12);
            
            featuredProps = featuredProps || [];

            // Mezcla Inteligente: 5 primeras fijas, el resto al azar
            if (featuredProps.length > 5) {
                const newest = featuredProps.slice(0, 5);
                const others = featuredProps.slice(5).sort(() => Math.random() - 0.5);
                featuredProps = [...newest, ...others];
            }

            res.render('index', { 
                title: 'Inicio | Cygnus Group',
                activePage: 'home',
                properties: featuredProps,
                filters: {},
                scrollResults: false,
                config: config
            });
        } catch (error) {
            console.error('Error home:', error);
            res.render('index', { title: 'Inicio', activePage: 'home', properties: [], config: {} });
        }
    },

    // 2. PÁGINA DE PROPIEDADES (CON INYECCIÓN SEO)
    propertiesPage: async (req, res) => {
        try {
            const { operacion, tipo, region, comuna, dorms, banos, min_price, max_price } = req.query;
            
            let query = supabase.from('properties').select('*')
                .in('status', ['publicado', 'reservado', 'vendido', 'arrendado'])
                .order('created_at', { ascending: false });

            // --- Filtros ---
            if (operacion) query = query.ilike('operation_type', operacion.trim());
            if (tipo) query = query.eq('category', tipo);
            if (region) {
                const regionNorm = region.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); 
                if (regionNorm.includes('bio')) query = query.or('address_region.ilike.%Bio%,address_region.ilike.%Bío%,address_region.ilike.%Biobío%,address_region.ilike.%Bío Bío%');
                else query = query.or(`address_region.ilike.%${region}%,address_region.ilike.%${regionNorm}%`);
            }
            if (comuna) {
                const comunaSinTildes = comuna.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                query = query.or(`address_commune.ilike.%${comuna}%,address_commune.ilike.%${comunaSinTildes}%`);
            }
            if (dorms) query = query.gte('bedrooms', parseInt(dorms));
            if (banos) query = query.gte('bathrooms', parseInt(banos));
            if (min_price) { const p = parseInt(min_price.replace(/\./g, '')); if(!isNaN(p)) query = query.gte('price', p); }
            if (max_price) { const p = parseInt(max_price.replace(/\./g, '')); if(!isNaN(p)) query = query.lte('price', p); }

            const { data: properties } = await query;

            let ufVal = 38000;
            if (req.app.locals.indicators && req.app.locals.indicators.uf) ufVal = req.app.locals.indicators.uf;

            // --- INICIO INYECCIÓN SEO ---
            // Lógica para que el título de la pestaña cambie según la búsqueda (Ej: "Casas en Concepción")
            let seoTitle = 'Propiedades en Venta y Arriendo | Cygnus Group';
            let seoDesc = 'Encuentra tu propiedad en Biobío y Ñuble. Gestión inmobiliaria experta.';

            const q = req.query; 
            
            if (q.operacion || q.tipo || q.comuna || q.region) {
                let parts = [];
                
                // Tipo (ej: "Casas", "Departamentos")
                if (q.tipo) parts.push(q.tipo + 's'); 
                else parts.push('Propiedades');
                
                // Operación (ej: "en Venta")
                if (q.operacion) parts.push('en ' + q.operacion);
                
                // Ubicación (ej: "en Concepción")
                if (q.comuna) parts.push('en ' + q.comuna);
                else if (q.region) parts.push('en ' + q.region);

                // Título Final: "Casas en Venta en Concepción | Cygnus Group"
                seoTitle = parts.join(' ') + ' | Cygnus Group';
                seoDesc = `Resultados de ${parts.join(' ')}. Revisa nuestro catálogo actualizado en la región.`;
            }
            // --- FIN INYECCIÓN SEO ---

            res.render('properties', { 
                title: seoTitle,   // Usamos el título dinámico
                activePage: 'propiedades',
                properties: properties || [],
                filters: req.query,
                ufVal: ufVal,
                ogTitle: seoTitle, // Para compartir en redes
                ogDesc: seoDesc    // Descripción dinámica
            });
        } catch (error) {
            console.error('Error properties:', error);
            res.redirect('/');
        }
    },

    // 3. NOSOTROS
    about: (req, res) => {
        res.render('about', { 
            title: 'Nosotros | Cygnus Group',
            activePage: 'nosotros'
        });
    },

    // 4. CONTACTO (Vista)
    contact: (req, res) => {
        res.render('contact', { 
            title: 'Contacto | Cygnus Group',
            activePage: 'contacto',
            msg: req.query.msg || null 
        });
    },

    // 5. ENVIAR CONTACTO (CORREGIDO: Usa emailHelper / Resend)
    sendContactEmail: async (req, res) => {
        const { nombre, email, telefono, asunto, mensaje } = req.body;

        try {
            // A. ENVÍO AL ADMINISTRADOR (A ti)
            const adminContent = `
                <p>Has recibido un nuevo mensaje desde el formulario web.</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: left;">
                    <p><strong>👤 Nombre:</strong> ${nombre}</p>
                    <p><strong>✉️ Email:</strong> ${email}</p>
                    <p><strong>📱 Teléfono:</strong> ${telefono || 'No especificado'}</p>
                    <p><strong>📝 Asunto:</strong> ${asunto}</p>
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 10px 0;">
                    <p><strong>Mensaje:</strong></p>
                    <p style="color: #475569;">${mensaje}</p>
                </div>
            `;

            // Enviar a contacto@cygnusgroup.cl
            await sendEmail(
                'contacto@cygnusgroup.cl', 
                `Nuevo Lead Web: ${nombre}`, 
                'Nuevo Contacto Web', 
                adminContent,
                'Responder al Cliente',
                `mailto:${email}`
            );

            // B. ENVÍO DE CONFIRMACIÓN AL CLIENTE (Auto-respuesta bonita)
            const clientContent = `
                <p>Hola <strong>${nombre}</strong>,</p>
                <p>Gracias por escribirnos. Hemos recibido tu mensaje correctamente y nuestro equipo lo está revisando.</p>
                <p>Nos pondremos en contacto contigo a la brevedad posible para responder a tu consulta sobre: <em>${asunto}</em>.</p>
                <p>Si es urgente, puedes llamarnos directamente o escribirnos por WhatsApp.</p>
            `;

            // Enviar al cliente
            await sendEmail(
                email,
                'Hemos recibido tu mensaje - Cygnus Group',
                '¡Gracias por contactarnos!',
                clientContent,
                'Ir al Sitio Web',
                'https://www.cygnusgroup.cl'
            );

            res.redirect('/contacto?msg=success');

        } catch (error) {
            console.error("Error enviando correo de contacto:", error);
            res.redirect('/contacto?msg=error');
        }
    },

    login: (req, res) => { res.render('index', { title: 'Acceso', activePage: 'login', config: {} }); },

    propertyDetail: async (req, res) => {
        try {
            const { id } = req.params;
            const { data: prop } = await supabase.from('properties').select(`*, agent:users(*)`).eq('id', id).single();
            
            let ufValue = 38000;
            if (req.app.locals.indicators && req.app.locals.indicators.uf) ufValue = req.app.locals.indicators.uf;

            res.render('property-detail', {
                title: prop ? prop.title : 'Detalle', 
                prop, 
                ufValue, 
                activePage: 'propiedades',
                googleMapsKey: 'AIzaSyBeMVmY5lCw_TvvUBr6uZh8VrVlWHrU7lg'
            });
        } catch(e) { res.redirect('/'); }
    },

    configPage: async (req, res) => {
        try {
            let { data: config } = await supabase.from('site_config').select('*').limit(1).single();
            if(!config) config = { maintenance_active: false, announcement_active: false, banners: [] };

            res.render('admin/configuracion', {
                title: 'Configuración del Sitio',
                user: req.session.user,
                config: config
            });
        } catch (error) {
            console.error(error);
            res.redirect('/dashboard');
        }
    },

   updateConfig: async (req, res) => {
        try {
            const { 
                maintenance_active, maintenance_message,
                announcement_active, announcement_bg, announcement_color, announcement_text,
                slider_speed,
                existing_banners_urls, existing_banners_align,
                new_banners_align,
                promo_strips_json, ticker_active, ticker_speed
            } = req.body;

            // --- Procesar Huinchas (Ticker de Promociones) ---
            let promoStrips = [];
            if (promo_strips_json) {
                try {
                    const parsed = JSON.parse(promo_strips_json);
                    if (Array.isArray(parsed)) promoStrips = parsed;
                } catch (e) {
                    console.warn('promo_strips_json inválido, se ignora.');
                }
            }

            // --- Procesar Banners existentes ---
            let finalBanners = [];
            if (existing_banners_urls) {
                const urls = Array.isArray(existing_banners_urls) ? existing_banners_urls : [existing_banners_urls];
                const aligns = Array.isArray(existing_banners_align) ? existing_banners_align : [existing_banners_align];
                urls.forEach((url, index) => {
                    finalBanners.push({ url: url, align: aligns[index] || '50% 50%' });
                });
            }

            // --- Banners nuevos (Cloudinary) ---
            if (req.files && req.files.length > 0) {
                let newAligns = [];
                if (new_banners_align) {
                    newAligns = Array.isArray(new_banners_align) ? new_banners_align : [new_banners_align];
                }
                for (let i = 0; i < req.files.length; i++) {
                    const file = req.files[i];
                    const result = await cloudinary.uploader.upload(file.path, { folder: 'cygnus_banners' });
                    const alignVal = newAligns[i] || '50% 50%';
                    finalBanners.push({ url: result.secure_url, public_id: result.public_id, align: alignVal });
                    try { require('fs').unlinkSync(file.path); } catch (e) {}
                }
            }

            const configData = {
                maintenance_active: maintenance_active === 'on',
                maintenance_message,
                announcement_active: announcement_active === 'on',
                announcement_bg,
                announcement_color,
                announcement_text,
                slider_speed: parseInt(slider_speed) || 5,
                banners: finalBanners,
                // --- Huinchas ---
                promo_strips: promoStrips,
                ticker_active: ticker_active === 'on',
                ticker_speed: parseInt(ticker_speed) || 35,
                updated_at: new Date()
            };

            // Intento principal con todas las columnas (incluyendo promo_strips)
            let { error } = await supabase.from('site_config').upsert({ id: 1, ...configData });

            // Fallback: si la columna promo_strips aún no existe en la BD, reintenta sin ella
            if (error && /promo_strips|ticker_active|ticker_speed/i.test(error.message || '')) {
                console.warn('⚠️ Columnas de huinchas no existen. Guardando sin ellas. Agrega en Supabase: promo_strips JSONB, ticker_active BOOLEAN, ticker_speed INT');
                const { promo_strips, ticker_active: _ta, ticker_speed: _ts, ...safeData } = configData;
                const retry = await supabase.from('site_config').upsert({ id: 1, ...safeData });
                if (retry.error) throw retry.error;
            } else if (error) {
                throw error;
            }

            res.redirect('/admin/configuracion?success=true');
        } catch (error) {
            console.error("Error updating config:", error);
            res.redirect('/admin/configuracion?error=true');
        }
    }
};

module.exports = mainController;