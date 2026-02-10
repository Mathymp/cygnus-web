// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN CRÍTICA ---
const BASE_URL = 'https://www.cygnusgroup.cl';

// Cliente Admin (Service Role)
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. VISTA LOGIN
    // =========================================================================
    loginForm: (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        res.render('login', { 
            title: 'Acceso Agentes | Cygnus', 
            error: null, 
            successMessage: null 
        });
    },

    // =========================================================================
    // 2. PROCESAR LOGIN (AJAX) - Lógica Blindada y Limpia (Sin updated_at)
    // =========================================================================
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        if (!email) return returnError('email', 'Por favor, ingresa tu correo.');
        if (!password) return returnError('password', 'Por favor, ingresa tu contraseña.');

        try {
            // A. Login Auth
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });

            if (authError) return returnError('password', 'Credenciales incorrectas o usuario no registrado.');

            // B. Gestión de Perfil en DB Pública
            const clientToUse = supabaseAdmin || supabase;
            const newUserId = authData.user.id;
            
            // 1. Intentar buscar perfil por ID
            let { data: user } = await clientToUse
                .from('users')
                .select('*')
                .eq('id', newUserId)
                .single();

            // 2. Si NO existe el perfil por ID, reparamos
            if (!user) {
                console.warn(`⚠️ Usuario ${email} sin perfil sincronizado. Iniciando reparación...`);
                
                // 2.1 Buscar "Zombie" (Email existe, ID viejo)
                const { data: zombieUser } = await clientToUse
                    .from('users')
                    .select('*')
                    .eq('email', email)
                    .single();

                // Datos base para el nuevo perfil
                const profileData = {
                    id: newUserId,
                    email: email,
                    name: zombieUser?.name || authData.user.user_metadata?.name || email.split('@')[0], 
                    role: zombieUser?.role || 'corredor', 
                    position: zombieUser?.position || 'Agente Inmobiliario',
                    phone: zombieUser?.phone || null,
                    photo_url: zombieUser?.photo_url || null,
                    password: password, 
                    created_at: new Date()
                    // SIN updated_at
                };

                if (zombieUser) {
                    console.warn(`🧟 Detectado ZOMBIE. Migrando propiedades y eliminando viejo...`);
                    
                    // A. Migrar Propiedades
                    await clientToUse
                        .from('properties')
                        .update({ agent_id: newUserId })
                        .eq('agent_id', zombieUser.id);
                    
                    // B. Eliminar Viejo
                    await clientToUse.from('users').delete().eq('id', zombieUser.id);
                }

                // 2.2 Crear Nuevo Perfil
                console.log(`🛠️ Creando perfil definitivo...`);
                const { error: insertError } = await clientToUse.from('users').insert(profileData);
                
                if (insertError) {
                    console.error("❌ Falló creación:", insertError);
                    await supabase.auth.signOut();
                    return returnError('email', 'Error creando perfil de base de datos.');
                }
                
                user = profileData;
                console.log("✨ Perfil sincronizado.");

            } else {
                // 3. Sync Password (si cambió)
                if (user.password !== password) {
                    await clientToUse.from('users').update({ password: password }).eq('id', user.id);
                }
            }

            // C. Crear Sesión
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url,
                position: user.position || 'Agente Inmobiliario'
            };

            logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión').catch(console.error);

            return res.json({ success: true, redirect: '/dashboard' });

        } catch (err) {
            console.error("Login Error:", err);
            return returnError('general', 'Error de conexión.');
        }
    },

    // =========================================================================
    // 3. RECUPERAR PASSWORD - ¡DISEÑO DE CORREO MEJORADO! 📧 ✨
    // =========================================================================
    recoverPassword: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        if (!email) return res.status(400).json({ success: false, message: 'Ingresa un correo válido.' });

        try {
            const { data: user } = await supabase.from('users').select('name').eq('email', email).single();
            
            if (!user) {
                await new Promise(r => setTimeout(r, 1000));
                return res.json({ success: true, message: 'Si el correo existe, recibirás instrucciones.' });
            }

            if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Error config servidor.' });

            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { redirectTo: `${BASE_URL}/update-password` }
            });

            if (linkError) throw linkError;

            // --- HTML DEL CORREO (Estilo Profesional) ---
            const htmlMessage = `
                <div style="text-align: left;">
                    <p style="font-size: 16px; color: #334155; margin-bottom: 20px;">
                        Hola <strong>${user.name}</strong>,
                    </p>
                    <p style="font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 15px;">
                        Hemos recibido una solicitud para actualizar las credenciales de seguridad de tu cuenta en <strong>Cygnus Group</strong>.
                    </p>
                    <p style="font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 25px;">
                        Para continuar con el proceso y definir una nueva contraseña, por favor utiliza el siguiente botón seguro. Este enlace es de uso único.
                    </p>
                </div>
                
                <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 20px;">
                     <p style="font-size: 13px; color: #94a3b8; font-style: italic;">
                        Si tú no solicitaste este cambio, por favor ignora este mensaje. Tu cuenta permanece segura.
                    </p>
                </div>
            `;
            
            await sendEmail(
                email, 
                '🔐 Recuperación de Acceso - Cygnus', // Asunto más serio
                'Restablecer Contraseña', // Título de la tarjeta
                htmlMessage,
                'Crear Nueva Contraseña', // Texto del botón
                linkData.properties.action_link
            );

            return res.json({ success: true, message: 'Correo enviado. Revisa tu bandeja.' });

        } catch (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Error interno.' });
        }
    },

    // 4. VISTA UPDATE
    showUpdatePassword: (req, res) => {
        res.render('update-password', { 
            title: 'Nueva Contraseña', 
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY 
        });
    },

    // 5. PROCESO UPDATE (Upsert sin updated_at)
    updatePassword: async (req, res) => {
        const { password, accessToken } = req.body;
        const sendError = (msg) => res.status(400).json({ success: false, message: msg });

        if (!password || password.length < 6) return sendError('Mínimo 6 caracteres.');
        if (!accessToken) return sendError('Link inválido.');

        try {
            const { data: { user }, error } = await supabase.auth.getUser(accessToken);
            if (error || !user) return sendError('Link expirado.');

            const client = supabaseAdmin || supabase;

            // 1. Update Auth
            if (supabaseAdmin) await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
            else await supabase.auth.updateUser({ password });

            // 2. Upsert DB Pública (SIN updated_at)
            await client.from('users').upsert({ 
                id: user.id,
                email: user.email,
                password: password,
                name: user.user_metadata?.name || user.email.split('@')[0],
                role: 'corredor',
                // Eliminado updated_at para evitar error PGRST204
            }, { onConflict: 'id' });

            await supabase.auth.signOut();
            req.session.destroy();

            return res.json({ success: true, message: 'Actualizado.', redirect: '/login' });

        } catch (error) {
            console.error(error);
            return sendError('Error interno.');
        }
    },

    logout: async (req, res) => {
        await supabase.auth.signOut();
        req.session.destroy(() => res.redirect('/login'));
    }
};

module.exports = authController;