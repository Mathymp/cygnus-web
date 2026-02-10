// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN CRÍTICA ---
// Forzamos la URL de producción para evitar errores de localhost en los correos
const BASE_URL = 'https://www.cygnusgroup.cl';

// Cliente Admin de Supabase (Necesario para generar links, gestionar usuarios y auto-reparar perfiles)
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. VISTA LOGIN (GET)
    // =========================================================================
    loginForm: (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        // Pasamos variables explícitas para evitar errores en la vista
        res.render('login', { 
            title: 'Acceso Agentes | Cygnus', 
            error: null, 
            successMessage: null 
        });
    },

    // =========================================================================
    // 2. PROCESAR LOGIN (AJAX - JSON) - ¡BLINDADO!
    // =========================================================================
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        // Función auxiliar para responder errores en formato JSON
        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        if (!email) return returnError('email', 'Por favor, ingresa tu correo.');
        if (!password) return returnError('password', 'Por favor, ingresa tu contraseña.');

        try {
            // A. Intentar Login con Supabase Auth (Credenciales)
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });

            if (authError) {
                return returnError('password', 'Credenciales incorrectas o usuario no registrado.');
            }

            // B. Buscar perfil en base de datos pública 'users'
            let { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            // --- LÓGICA DE AUTO-REPARACIÓN (BLINDAJE) ---
            // Si el usuario autenticó bien, pero no tiene perfil en la tabla 'users', lo creamos AHORA.
            if (!user) {
                console.warn(`⚠️ Usuario ${email} autenticado pero sin perfil. Iniciando auto-creación...`);
                
                // Datos para el nuevo perfil
                const newProfile = {
                    id: authData.user.id,
                    email: email,
                    // Intentamos sacar el nombre de los metadatos o usamos la parte del correo antes del @
                    name: authData.user.user_metadata?.name || email.split('@')[0], 
                    role: 'corredor', // Rol por defecto seguro
                    photo_url: null,
                    created_at: new Date()
                };

                // Usamos supabaseAdmin si existe para saltarnos restricciones (RLS)
                const clientToUse = supabaseAdmin || supabase;
                
                const { error: insertError } = await clientToUse
                    .from('users')
                    .insert(newProfile);

                if (insertError) {
                    console.error("❌ Falló la auto-creación del perfil:", insertError);
                    await supabase.auth.signOut();
                    return returnError('email', 'Error de cuenta: No se pudo generar tu perfil. Contacta a soporte.');
                }

                // Si funcionó, asignamos el nuevo perfil a la variable user para continuar
                console.log("✅ Perfil creado automáticamente.");
                user = newProfile;
            }

            // C. Crear la sesión del usuario
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url,
                position: user.position || 'Agente Inmobiliario'
            };

            // D. Registrar actividad (Log silencioso)
            logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión exitosamente')
                .catch(err => console.error('Error guardando log:', err));

            // E. Respuesta exitosa (Frontend redirige)
            return res.json({ 
                success: true, 
                redirect: '/dashboard' 
            });

        } catch (err) {
            console.error("Critical Login Error:", err);
            return returnError('general', 'Error de conexión con el servidor.');
        }
    },

    // =========================================================================
    // 3. RECUPERAR CONTRASEÑA (AJAX - Envía Correo)
    // =========================================================================
    recoverPassword: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        
        if (!email) {
            return res.status(400).json({ success: false, message: 'Ingresa un correo válido.' });
        }

        try {
            // 1. Verificar si el usuario existe (opcional, para obtener nombre)
            const { data: user } = await supabase
                .from('users')
                .select('name')
                .eq('email', email)
                .single();
            
            // Si no existe en DB, simulamos éxito por seguridad
            if (!user) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return res.json({ 
                    success: true, 
                    message: 'Si el correo está registrado, recibirás las instrucciones.' 
                });
            }

            if (!supabaseAdmin) {
                console.error("Falta SUPABASE_SERVICE_ROLE_KEY");
                return res.status(500).json({ success: false, message: 'Error de configuración del servidor.' });
            }

            // 2. Generar Link Mágico
            // Forzamos redirectTo a tu dominio real para evitar errores
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { 
                    redirectTo: `${BASE_URL}/update-password` 
                }
            });

            if (linkError) throw linkError;

            // 3. Mensaje HTML
            const htmlMessage = `
                <p>Hola <strong>${user.name}</strong>,</p>
                <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
                <p>Este enlace es seguro y de un solo uso.</p>
            `;
            
            // 4. Enviar correo
            await sendEmail(
                email, 
                'Restablecer Contraseña 🔒', 
                'Recuperación de Acceso', 
                htmlMessage,
                'Crear Nueva Contraseña', 
                linkData.properties.action_link
            );

            return res.json({ success: true, message: 'Correo enviado. Revisa tu bandeja de entrada.' });

        } catch (err) {
            console.error("Recovery Error:", err);
            return res.status(500).json({ success: false, message: 'Hubo un problema procesando tu solicitud.' });
        }
    },

    // =========================================================================
    // 4. VISTA ACTUALIZAR CONTRASEÑA (GET)
    // =========================================================================
    showUpdatePassword: (req, res) => {
        res.render('update-password', { 
            title: 'Nueva Contraseña | Cygnus', 
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY 
        });
    },

    // =========================================================================
    // 5. PROCESAR ACTUALIZACIÓN (POST - AJAX)
    // =========================================================================
    updatePassword: async (req, res) => {
        const { password, accessToken } = req.body;
        const sendError = (msg) => res.status(400).json({ success: false, message: msg });

        if (!password || password.length < 6) return sendError('La contraseña es muy corta (mínimo 6 caracteres).');
        if (!accessToken) return sendError('El enlace de recuperación no es válido.');

        try {
            // 1. Validar el token con Supabase
            const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

            if (userError || !user) {
                return sendError('El enlace de seguridad ha expirado. Solicita uno nuevo.');
            }

            // 2. Actualizar la contraseña (Usamos Admin si existe para máxima autoridad)
            if (supabaseAdmin) {
                await supabaseAdmin.auth.admin.updateUserById(user.id, { password: password });
            } else {
                await supabase.auth.updateUser({ password: password });
            }

            // 3. Sincronizar tabla pública 'users' (Opcional, pero recomendado para consistencia)
            // Usamos Admin o Cliente según disponibilidad
            const clientToUse = supabaseAdmin || supabase;
            
            const { error: dbError } = await clientToUse
                .from('users')
                .update({ password: password }) // Si guardas hash o flag
                .eq('id', user.id);
            
            // Si la sincronización falla porque el usuario no existe en 'users', 
            // no lanzamos error aquí. El próximo Login usará la "Auto-Reparación" que programamos arriba.

            // 4. Cerrar sesión global
            await supabase.auth.signOut();
            req.session.destroy();

            // 5. Éxito
            return res.json({ 
                success: true, 
                message: 'Contraseña actualizada exitosamente.',
                redirect: '/login' 
            });

        } catch (error) {
            console.error("Update Pass Error:", error);
            return sendError('Error interno del sistema.');
        }
    },

    // =========================================================================
    // 6. CERRAR SESIÓN
    // =========================================================================
    logout: async (req, res) => {
        await supabase.auth.signOut();
        req.session.destroy((err) => {
            if (err) console.error("Error destruyendo sesión:", err);
            res.redirect('/login');
        });
    }
};

module.exports = authController;