const supabase = require('../config/supabaseClient');
const cloudinary = require('../config/cloudinaryConfig');
const fs = require('fs');
const nodemailer = require('nodemailer'); // RECUERDA: npm install nodemailer

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

    // 2. PÁGINA DE PROPIEDADES
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

            res.render('properties', { 
                title: 'Propiedades | Cygnus Group',
                activePage: 'propiedades',
                properties: properties || [],
                filters: req.query,
                ufVal: ufVal
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

    // 5. ENVIAR CONTACTO (Lógica SMTP Corporativo)
    sendContactEmail: async (req, res) => {
        const { nombre, email, telefono, asunto, mensaje } = req.body;

        try {
            // Configuración SMTP para mail.cygnusgroup.cl
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST, // Lee mail.cygnusgroup.cl
                port: process.env.SMTP_PORT, // Lee 465
                secure: true, // True para puerto 465 (SSL/TLS)
                auth: {
                    user: process.env.SMTP_USER, // contacto@cygnusgroup.cl
                    pass: process.env.SMTP_PASS  // Tu contraseña real
                },
                tls: {
                    // Ayuda si el certificado SSL tiene algún problema menor, 
                    // aunque en producción idealmente no se usa rejectUnauthorized: false
                    rejectUnauthorized: false 
                }
            });

            const mailOptions = {
                from: `"Web Cygnus" <${process.env.SMTP_USER}>`,
                to: 'contacto@cygnusgroup.cl', // Se envía a sí mismo (o a quien deba recibir las alertas)
                replyTo: email, // Para que al dar "Responder" le escribas al cliente
                subject: `Nuevo Mensaje Web: ${asunto} - ${nombre}`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #2563eb;">Nuevo contacto desde la web</h2>
                        <hr>
                        <p><strong>Nombre:</strong> ${nombre}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Teléfono:</strong> ${telefono}</p>
                        <p><strong>Asunto:</strong> ${asunto}</p>
                        <br>
                        <p><strong>Mensaje:</strong></p>
                        <div style="background:#f4f6f8; padding:15px; border-radius: 8px; border-left: 4px solid #2563eb;">
                            ${mensaje}
                        </div>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            res.redirect('/contacto?msg=success');

        } catch (error) {
            console.error("Error enviando correo SMTP:", error);
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
                new_banners_align 
            } = req.body;

            let finalBanners = [];
            
            if (existing_banners_urls) {
                const urls = Array.isArray(existing_banners_urls) ? existing_banners_urls : [existing_banners_urls];
                const aligns = Array.isArray(existing_banners_align) ? existing_banners_align : [existing_banners_align];
                urls.forEach((url, index) => {
                    finalBanners.push({ url: url, align: aligns[index] || '50% 50%' });
                });
            }

            if (req.files && req.files.length > 0) {
                let newAligns = [];
                if(new_banners_align) {
                    newAligns = Array.isArray(new_banners_align) ? new_banners_align : [new_banners_align];
                }
                for (let i = 0; i < req.files.length; i++) {
                    const file = req.files[i];
                    const result = await cloudinary.uploader.upload(file.path, { folder: 'cygnus_banners' });
                    const alignVal = newAligns[i] || '50% 50%';
                    finalBanners.push({ url: result.secure_url, public_id: result.public_id, align: alignVal });
                    try { require('fs').unlinkSync(file.path); } catch(e){}
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
                updated_at: new Date()
            };

            const { error } = await supabase.from('site_config').upsert({ id: 1, ...configData });
            if(error) throw error;
            res.redirect('/admin/configuracion?success=true');
        } catch (error) {
            console.error("Error updating config:", error);
            res.redirect('/admin/configuracion?error=true');
        }
    }
};

module.exports = mainController;