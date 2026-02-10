// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN CRÍTICA ---
const BASE_URL = 'https://www.cygnusgroup.cl';

// Cliente Admin de Supabase
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. VISTA LOGIN (GET)
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
    // 2. PROCESAR LOGIN (AJAX) - ¡PROTECCIÓN TOTAL!
    // =========================================================================
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body; // Pass real

        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        if (!email) return returnError('email', 'Por favor, ingresa tu correo.');
        if (!password) return returnError('password', 'Por favor, ingresa tu contraseña.');

        try {
            // A. Login Auth (Verdad Suprema)
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });

            if (authError) {
                return returnError('password', 'Credenciales incorrectas o usuario no registrado.');
            }

            // B. Sincronización DB Pública (users)
            // Usamos Admin para saltar RLS y poder arreglar perfiles rotos
            const clientToUse = supabaseAdmin || supabase;
            
            // 1. Buscar perfil por ID (Camino Feliz)
            let { data: user } = await clientToUse
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            // 2. Lógica de Reparación Quirúrgica
            if (!user) {
                console.warn(`⚠️ Login: Usuario ${email} en Auth pero no en DB por ID. Iniciando diagnóstico...`);
                
                // 2.1 Buscar por Email (Caso Zombie: ID cambió)
                const { data: userByEmail } = await clientToUse
                    .from('users')
                    .select('*')
                    .eq('email', email)
                    .single();

                if (userByEmail) {
                    console.log("♻️ Reparando: Actualizando ID del usuario existente.");
                    // Actualizamos el ID antiguo por el nuevo y la password
                    await clientToUse
                        .from('users')
                        .update({ 
                            id: authData.user.id,
                            password: password, // Sincronizamos pass también
                            updated_at: new Date()
                        })
                        .eq('email', email);
                    
                    // Recuperamos el usuario actualizado
                    const { data: refreshedUser } = await clientToUse.from('users').select('*').eq('id', authData.user.id).single();
                    user = refreshedUser;
                } else {
                    // 2.2 Caso Fantasma: No existe ni por ID ni por Email (Crear Nuevo)
                    console.log("🛠️ Reparando: Creando perfil nuevo desde cero.");
                    const newProfile = {
                        id: authData.user.id,
                        email: email,
                        name: authData.user.user_metadata?.name || email.split('@')[0], 
                        role: 'corredor',
                        password: password, // Pass real obligatoria
                        photo_url: null,
                        created_at: new Date()
                    };

                    const { error: insertError } = await clientToUse.from('users').insert(newProfile);
                    
                    if (insertError) {
                        console.error("❌ Falló auto-creación:", insertError);
                        await supabase.auth.signOut();
                        return returnError('email', 'Error crítico de cuenta. Contacta a soporte.');
                    }
                    user = newProfile;
                }
            } else {
                // 3. Mantenimiento Preventivo (Si ya existía, actualizamos pass por si acaso)
                // Esto asegura que la DB pública siempre tenga la última contraseña válida
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
            console.error("Login System Error:", err);
            return returnError('general', 'Error de conexión con el servidor.');
        }
    },

    // =========================================================================
    // 3. RECUPERAR PASSWORD (AJAX)
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

            if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Error de configuración.' });

            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { redirectTo: `${BASE_URL}/update-password` }
            });

            if (linkError) throw linkError;

            const htmlMessage = `<p>Hola <strong>${user.name}</strong>,</p><p>Recupera tu acceso aquí:</p>`;
            
            await sendEmail(
                email, 
                'Restablecer Contraseña 🔒', 
                'Recuperación', 
                htmlMessage,
                'Crear Nueva Clave', 
                linkData.properties.action_link
            );

            return res.json({ success: true, message: 'Correo enviado.' });

        } catch (err) {
            console.error("Recovery Error:", err);
            return res.status(500).json({ success: false, message: 'Error interno.' });
        }
    },

    // =========================================================================
    // 4. VISTA UPDATE (GET)
    // =========================================================================
    showUpdatePassword: (req, res) => {
        res.render('update-password', { 
            title: 'Nueva Contraseña | Cygnus', 
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY 
        });
    },

    // =========================================================================
    // 5. PROCESAR ACTUALIZACIÓN (AJAX) - ¡PROTECCIÓN TOTAL!
    // =========================================================================
    updatePassword: async (req, res) => {
        const { password, accessToken } = req.body;
        const sendError = (msg) => res.status(400).json({ success: false, message: msg });

        if (!password || password.length < 6) return sendError('Mínimo 6 caracteres.');
        if (!accessToken) return sendError('Enlace inválido.');

        try {
            // 1. Validar Token
            const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
            if (userError || !user) return sendError('El enlace ha expirado.');

            const clientToUse = supabaseAdmin || supabase;

            // 2. Actualizar en AUTH (Prioridad 1)
            if (supabaseAdmin) {
                await supabaseAdmin.auth.admin.updateUserById(user.id, { password: password });
            } else {
                await supabase.auth.updateUser({ password: password });
            }

            // 3. Sincronizar en DB PÚBLICA (Quirúrgico: Upsert)
            // Usamos 'upsert' para cubrir creación y actualización en un solo paso
            const { error: dbError } = await clientToUse
                .from('users')
                .upsert({ 
                    id: user.id,
                    email: user.email,
                    password: password, // Pass real
                    // Si es insert, necesitamos estos campos (si es update, se ignoran o sobrescriben)
                    name: user.user_metadata?.name || user.email.split('@')[0],
                    role: 'corredor', // Default seguro
                    updated_at: new Date()
                }, { onConflict: 'id' }); // Clave para decidir si es update

            if (dbError) {
                console.error("⚠️ Advertencia Update: DB Pública no sincronizada:", dbError);
                // No bloqueamos, porque Auth ya cambió la clave. 
                // El login se encargará de reparar cualquier inconsistencia restante.
            }

            // 4. Cerrar sesión
            await supabase.auth.signOut();
            req.session.destroy();

            return res.json({ 
                success: true, 
                message: 'Contraseña actualizada correctamente.',
                redirect: '/login' 
            });

        } catch (error) {
            console.error("Update Pass Error:", error);
            return sendError('Error interno.');
        }
    },

    // =========================================================================
    // 6. LOGOUT
    // =========================================================================
    logout: async (req, res) => {
        await supabase.auth.signOut();
        req.session.destroy((err) => {
            if (err) console.error("Session destroy error:", err);
            res.redirect('/login');
        });
    }
};

module.exports = authController;