// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// Cliente Admin (Para links mágicos)
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // Vista (GET)
    loginForm: (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        res.render('login', { title: 'Acceso Agentes | Cygnus' });
    },

    // -------------------------------------------------------------------------
    // LOGIN "PRO" (Responde JSON para AJAX)
    // -------------------------------------------------------------------------
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        // Función auxiliar para responder error JSON
        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        if (!email) return returnError('email', 'Ingresa tu correo corporativo.');
        if (!password) return returnError('password', 'Ingresa tu contraseña.');

        try {
            // 1. Auth con Supabase
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

            if (authError) {
                // Aquí decidimos qué campo marcar en rojo
                return returnError('password', 'Contraseña incorrecta o usuario no encontrado.');
            }

            // 2. Buscar datos en tabla pública
            const { data: user } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (!user) {
                await supabase.auth.signOut();
                return returnError('email', 'Usuario sin perfil activo en Cygnus.');
            }

            // 3. Crear Sesión
            req.session.user = {
                id: user.id, email: user.email, name: user.name,
                role: user.role, photo: user.photo_url, position: user.position || 'Agente'
            };

            // 4. Log (Asíncrono para no frenar)
            logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión').catch(console.error);

            // 5. ÉXITO (El frontend redirigirá)
            return res.json({ success: true, redirect: '/dashboard' });

        } catch (err) {
            console.error("Login Error:", err);
            return returnError('general', 'Error de conexión. Intenta más tarde.');
        }
    },

    // -------------------------------------------------------------------------
    // RECUPERAR CONTRASEÑA (AJAX + Email Bonito)
    // -------------------------------------------------------------------------
    recoverPassword: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        
        if (!email) return res.status(400).json({ success: false, message: 'Ingresa un correo.' });

        try {
            // Verificar usuario localmente primero
            const { data: user } = await supabase.from('users').select('name').eq('email', email).single();
            
            // Si no existe, simulamos éxito por seguridad
            if (!user) {
                return res.json({ success: true, message: 'Si el correo existe, enviamos las instrucciones.' });
            }

            if (!supabaseAdmin) throw new Error("Falta Service Role Key");

            // Generar Link
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { redirectTo: `${req.protocol}://${req.get('host')}/update-password` }
            });

            if (linkError) throw linkError;

            // ENVIAR CORREO HERMOSO
            const htmlMessage = `
                <p>Hola <strong>${user.name}</strong>,</p>
                <p>Hemos recibido una solicitud para restablecer tu contraseña en el sistema Cygnus.</p>
                <p>Haz clic en el botón a continuación para crear una nueva clave segura:</p>
            `;

            await sendEmail(
                email, 
                'Recuperar Acceso 🔒', 
                'Restablecer Contraseña', 
                htmlMessage,
                'Crear Nueva Clave',
                linkData.properties.action_link
            );

            return res.json({ success: true, message: 'Correo enviado. Revisa tu bandeja de entrada.' });

        } catch (err) {
            console.error("Recovery Error:", err);
            return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
        }
    },

    // -------------------------------------------------------------------------
    // UPDATE PASSWORD (GET & POST)
    // -------------------------------------------------------------------------
    showUpdatePassword: (req, res) => {
        res.render('update-password', { 
            title: 'Nueva Contraseña', 
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY
        });
    },

    updatePassword: async (req, res) => {
        // Este sigue siendo un form submit tradicional porque viene de un link externo
        const { password, accessToken } = req.body;

        try {
            let userId = null;
            if (accessToken) {
                const { data: { user } } = await supabase.auth.getUser(accessToken);
                if (user) userId = user.id;
            } else if (req.session.user) {
                userId = req.session.user.id;
            }

            if (!userId) throw new Error("Link expirado");

            if (supabaseAdmin) await supabaseAdmin.auth.admin.updateUserById(userId, { password });
            else await supabase.auth.updateUser({ password });

            await supabase.from('users').update({ password }).eq('id', userId);
            await supabase.auth.signOut();
            req.session.destroy();

            res.render('login', { title: 'Iniciar Sesión', successMessage: '¡Clave actualizada! Ingresa ahora.' });

        } catch (error) {
            res.render('login', { title: 'Iniciar Sesión', error: 'El enlace expiró. Solicita uno nuevo.' });
        }
    },

    logout: async (req, res) => {
        await supabase.auth.signOut();
        req.session.destroy(() => res.redirect('/login'));
    }
};

module.exports = authController;