// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN CRÍTICA ---
// Forzamos la URL de producción para evitar errores de localhost en los correos
const BASE_URL = 'https://www.cygnusgroup.cl';

// Cliente Admin de Supabase (Necesario para generar links y gestionar usuarios)
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
    // 2. PROCESAR LOGIN (AJAX - JSON)
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
            // A. Intentar Login con Supabase
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });

            if (authError) {
                // No damos pistas si es el mail o la pass por seguridad, pero marcamos pass
                return returnError('password', 'Credenciales incorrectas o usuario no registrado.');
            }

            // B. Verificar que el usuario exista en nuestra tabla pública 'users'
            const { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (dbError || !user) {
                await supabase.auth.signOut();
                return returnError('email', 'Usuario autenticado pero sin perfil de agente activo.');
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
            return returnError('general', 'Error de conexión con el servidor. Intenta nuevamente.');
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
            // 1. Verificar si el usuario existe en nuestra DB (para obtener su nombre)
            const { data: user } = await supabase
                .from('users')
                .select('name')
                .eq('email', email)
                .single();
            
            // Si no existe, simulamos éxito por seguridad (para no revelar correos registrados)
            if (!user) {
                // Pequeña pausa para simular procesamiento
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

            // 2. Generar Link Mágico (Token de un solo uso)
            // AQUÍ ESTÁ EL TRUCO: Forzamos redirectTo a tu dominio real
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
                <p>Hemos recibido una solicitud para restablecer tu contraseña de acceso al panel de gestión.</p>
                <p>Este enlace es seguro, de un solo uso y caducará pronto.</p>
            `;
            
            // 4. Enviar correo usando tu helper
            const emailSent = await sendEmail(
                email, 
                'Restablecer Contraseña 🔒', // Asunto
                'Recuperación de Acceso',    // Título interno
                htmlMessage,                 // Cuerpo
                'Crear Nueva Contraseña',    // Texto del botón
                linkData.properties.action_link // Link generado
            );

            if (emailSent) {
                return res.json({ success: true, message: 'Correo enviado. Revisa tu bandeja de entrada.' });
            } else {
                throw new Error("Fallo al enviar el email.");
            }

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

        if (!password || password.length < 6) {
            return sendError('La contraseña es muy corta (mínimo 6 caracteres).');
        }

        if (!accessToken) {
            return sendError('El enlace de recuperación no es válido o ha expirado.');
        }

        try {
            // 1. Validar el token con Supabase
            const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

            if (userError || !user) {
                return sendError('El enlace de seguridad ha expirado. Por favor solicita uno nuevo.');
            }

            // 2. Actualizar la contraseña
            if (supabaseAdmin) {
                // Método Admin (Más seguro y sin rate limits)
                await supabaseAdmin.auth.admin.updateUserById(user.id, { password: password });
            } else {
                // Método Cliente
                await supabase.auth.updateUser({ password: password });
            }

            // 3. Asegurar que la sesión se destruya para obligar a loguearse de nuevo
            await supabase.auth.signOut();
            req.session.destroy();

            // 4. Éxito
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