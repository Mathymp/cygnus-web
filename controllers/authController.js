// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN CRÍTICA ---
// Forzamos la URL de producción para evitar errores de localhost en los correos
const BASE_URL = 'https://www.cygnusgroup.cl';

// Cliente Admin de Supabase (Necesario para generar links, gestionar usuarios y auto-reparar perfiles)
// Este cliente tiene permisos totales, úsalo con cuidado.
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. VISTA LOGIN (GET)
    // =========================================================================
    loginForm: (req, res) => {
        // Si ya hay sesión, mandamos al dashboard directamente
        if (req.session.user) return res.redirect('/dashboard');
        
        // Renderizamos la vista con variables limpias para evitar errores EJS
        res.render('login', { 
            title: 'Acceso Agentes | Cygnus', 
            error: null, 
            successMessage: null 
        });
    },

    // =========================================================================
    // 2. PROCESAR LOGIN (AJAX - JSON) - ¡CON AUTO-REPARACIÓN!
    // =========================================================================
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body; // <--- AQUÍ CAPTURAMOS LA CONTRASEÑA REAL

        // Función auxiliar para responder errores en formato JSON
        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        // Validaciones básicas
        if (!email) return returnError('email', 'Por favor, ingresa tu correo.');
        if (!password) return returnError('password', 'Por favor, ingresa tu contraseña.');

        try {
            // A. Intentar Login con Supabase Auth (Credenciales de seguridad)
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });

            if (authError) {
                // Si falla aquí, es que la contraseña está mal o el usuario no existe en Auth
                return returnError('password', 'Credenciales incorrectas o usuario no registrado.');
            }

            // B. Buscar perfil en base de datos pública 'users'
            let { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            // =================================================================
            // --- INICIO: LÓGICA DE BLINDAJE (AUTO-CREACIÓN) ---
            // =================================================================
            // Si el usuario autenticó bien en Auth, pero NO tiene perfil en la tabla 'users',
            // significa que hubo un error al crearlo. Lo arreglamos aquí mismo.
            if (!user) {
                console.warn(`⚠️ ALERTA: Usuario ${email} autenticado en Auth pero sin perfil en DB. Iniciando auto-reparación...`);
                
                // Creamos el objeto del perfil nuevo
                const newProfile = {
                    id: authData.user.id,
                    email: email,
                    // Intentamos obtener el nombre de los metadatos de Auth, o usamos el correo
                    name: authData.user.user_metadata?.name || email.split('@')[0], 
                    role: 'corredor', // Rol seguro por defecto
                    // ¡IMPORTANTE! Usamos la contraseña REAL que acabamos de recibir
                    password: password, 
                    photo_url: null,
                    created_at: new Date()
                };

                // Usamos el cliente Admin si está disponible para saltarnos restricciones RLS
                const clientToUse = supabaseAdmin || supabase;
                
                const { error: insertError } = await clientToUse
                    .from('users')
                    .insert(newProfile);

                if (insertError) {
                    console.error("❌ ERROR CRÍTICO: Falló la auto-creación del perfil:", insertError);
                    // Cerramos la sesión de Auth porque el sistema no está consistente
                    await supabase.auth.signOut();
                    return returnError('email', 'Error de integridad: Tu cuenta existe pero no tiene perfil de datos. Contacta al administrador.');
                }

                // Si funcionó, asignamos el nuevo perfil a la variable 'user' para que el login continúe
                console.log("✅ ÉXITO: Perfil creado y reparado automáticamente.");
                user = newProfile;
            }
            // =================================================================
            // --- FIN LÓGICA DE BLINDAJE ---
            // =================================================================

            // C. Crear la sesión del usuario en el servidor (Express Session)
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url,
                position: user.position || 'Agente Inmobiliario'
            };

            // D. Registrar actividad (Log silencioso para no frenar la respuesta)
            logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión exitosamente')
                .catch(err => console.error('Error guardando log:', err));

            // E. Respuesta exitosa (El frontend redirigirá)
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
            // 1. Verificar si el usuario existe en DB pública (para obtener su nombre)
            const { data: user } = await supabase
                .from('users')
                .select('name')
                .eq('email', email)
                .single();
            
            // Si no existe en DB, simulamos éxito por seguridad (para no revelar correos)
            if (!user) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Pausa de seguridad
                return res.json({ 
                    success: true, 
                    message: 'Si el correo está registrado, recibirás las instrucciones.' 
                });
            }

            if (!supabaseAdmin) {
                console.error("Falta SUPABASE_SERVICE_ROLE_KEY");
                return res.status(500).json({ success: false, message: 'Error de configuración del servidor.' });
            }

            // 2. Generar Link Mágico (Token de un solo uso)
            // Forzamos redirectTo a tu dominio real
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { 
                    redirectTo: `${BASE_URL}/update-password` 
                }
            });

            if (linkError) throw linkError;

            // 3. Preparar mensaje HTML bonito
            const htmlMessage = `
                <p>Hola <strong>${user.name}</strong>,</p>
                <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
                <p>Este enlace es seguro y de un solo uso.</p>
            `;
            
            // 4. Enviar correo usando tu helper
            await sendEmail(
                email, 
                'Restablecer Contraseña 🔒', 
                'Recuperación de Acceso', 
                htmlMessage,
                'Crear Nueva Clave', 
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
        // Renderizamos la vista 'update-password.ejs'
        // Pasamos las credenciales públicas para que el frontend pueda validar el hash
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
                return sendError('El enlace de seguridad ha expirado. Por favor solicita uno nuevo.');
            }

            // 2. Actualizar la contraseña en AUTH
            // Usamos Admin si existe para evitar bloqueos
            if (supabaseAdmin) {
                await supabaseAdmin.auth.admin.updateUserById(user.id, { password: password });
            } else {
                await supabase.auth.updateUser({ password: password });
            }

            // 3. Sincronizar tabla pública 'users'
            // IMPORTANTE: Aquí también guardamos la contraseña real para mantener consistencia
            const clientToUse = supabaseAdmin || supabase;
            
            const { error: dbError } = await clientToUse
                .from('users')
                .update({ password: password }) 
                .eq('id', user.id);
            
            // 4. Cerrar sesión globalmente y limpiar sesión del servidor
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