// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// Cliente Admin (Necesario para generar links de recuperación y forzar updates)
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. VISTA LOGIN (GET) - Carga la página normal
    // =========================================================================
    loginForm: (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        res.render('login', { title: 'Acceso Agentes | Cygnus' });
    },

    // =========================================================================
    // 2. PROCESAR LOGIN (POST - AJAX) - Devuelve JSON
    // =========================================================================
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        // Helper para devolver error JSON rápido
        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        if (!email) return returnError('email', 'Ingresa tu correo corporativo.');
        if (!password) return returnError('password', 'Ingresa tu contraseña.');

        try {
            // A. Autenticar con Supabase
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

            if (authError) {
                return returnError('password', 'Contraseña incorrecta o usuario no encontrado.');
            }

            // B. Buscar perfil en base de datos pública
            const { data: user } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (!user) {
                await supabase.auth.signOut();
                return returnError('email', 'Usuario autenticado pero sin perfil activo.');
            }

            // C. Crear Sesión
            req.session.user = {
                id: user.id, email: user.email, name: user.name,
                role: user.role, photo: user.photo_url, position: user.position || 'Agente'
            };

            // D. Registrar actividad (sin esperar promesa para agilidad)
            logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión').catch(console.error);

            // E. ÉXITO: Mandamos la URL a donde debe ir el frontend
            return res.json({ success: true, redirect: '/dashboard' });

        } catch (err) {
            console.error("Login Error:", err);
            return returnError('general', 'Error de conexión con el servidor.');
        }
    },

    // =========================================================================
    // 3. RECUPERAR PASSWORD (POST - AJAX)
    // =========================================================================
    recoverPassword: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        
        if (!email) return res.status(400).json({ success: false, message: 'Ingresa un correo válido.' });

        try {
            // Verificar usuario localmente (para obtener el nombre)
            const { data: user } = await supabase.from('users').select('name').eq('email', email).single();
            
            // Si no existe, simulamos éxito por seguridad
            if (!user) {
                await new Promise(r => setTimeout(r, 1000)); // Pausa de seguridad
                return res.json({ success: true, message: 'Si el correo existe, recibirás instrucciones.' });
            }

            if (!supabaseAdmin) throw new Error("Falta Service Key en servidor");

            // Generar Link Mágico
            // Importante: Redirige a /update-password donde el frontend capturará el hash
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { redirectTo: `${req.protocol}://${req.get('host')}/update-password` }
            });

            if (linkError) throw linkError;

            // HTML del correo
            const htmlMessage = `
                <p>Hola <strong>${user.name}</strong>,</p>
                <p>Hemos recibido una solicitud para restablecer tu contraseña en Cygnus Group.</p>
                <p>Haz clic en el botón a continuación para crear una nueva clave segura:</p>
            `;
            
            await sendEmail(
                email, 
                'Restablecer Contraseña 🔒', 
                'Recuperación de Acceso', 
                htmlMessage,
                'Crear Nueva Clave',
                linkData.properties.action_link
            );

            return res.json({ success: true, message: '¡Correo enviado! Revisa tu bandeja de entrada.' });

        } catch (err) {
            console.error("Recovery Error:", err);
            return res.status(500).json({ success: false, message: 'Error interno al procesar solicitud.' });
        }
    },

    // =========================================================================
    // 4. VISTA UPDATE PASSWORD (GET) - Renderiza la página con credenciales
    // =========================================================================
    showUpdatePassword: (req, res) => {
        // Pasamos las credenciales públicas para que el frontend pueda verificar el token
        res.render('update-password', { 
            title: 'Nueva Contraseña | Cygnus', 
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY // Key anónima pública
        });
    },

    // =========================================================================
    // 5. PROCESAR NUEVA CONTRASEÑA (POST - AJAX)
    // =========================================================================
    updatePassword: async (req, res) => {
        const { password, accessToken } = req.body;

        // Helper de error JSON
        const sendError = (msg) => res.status(400).json({ success: false, message: msg });

        if (!password || password.length < 6) {
            return sendError('La contraseña debe tener al menos 6 caracteres.');
        }

        if (!accessToken) {
            return sendError('No se detectó una sesión segura. El enlace puede estar roto.');
        }

        try {
            // 1. Verificar la sesión con el Token que nos envía el frontend
            const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

            if (userError || !user) {
                return sendError('El enlace ha expirado o no es válido. Solicita uno nuevo.');
            }

            // 2. Actualizar la contraseña
            if (supabaseAdmin) {
                // Opción Admin (más segura y robusta)
                await supabaseAdmin.auth.admin.updateUserById(user.id, { password: password });
            } else {
                // Opción Cliente
                await supabase.auth.updateUser({ password: password });
            }

            // 3. Sincronizar tabla pública 'users' (si guardas hash o flag de cambio)
            // Nota: Supabase Auth ya maneja la pass, esto es por si tienes lógica extra
            await supabase
                .from('users')
                .update({ password: password }) 
                .eq('id', user.id);

            // 4. Cerrar sesión globalmente y limpiar sesión del servidor
            await supabase.auth.signOut();
            req.session.destroy();

            // 5. Respuesta Exitosa
            return res.json({ 
                success: true, 
                message: 'Contraseña actualizada correctamente.',
                redirect: '/login' 
            });

        } catch (error) {
            console.error("Update Pass Error:", error);
            return sendError('Error interno del servidor. Intenta más tarde.');
        }
    },

    // =========================================================================
    // 6. LOGOUT
    // =========================================================================
    logout: async (req, res) => {
        await supabase.auth.signOut();
        req.session.destroy(() => res.redirect('/login'));
    }
};

module.exports = authController;