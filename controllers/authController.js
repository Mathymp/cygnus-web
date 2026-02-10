// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// Inicializamos Cliente Admin (Necesario para generar links de recuperación y forzar cambios)
// Si no existe la key en el .env, algunas funciones de recuperación no servirán, pero el login sí.
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. INICIAR SESIÓN
    // =========================================================================
    
    // Vista del formulario (GET)
    loginForm: (req, res) => {
        if (req.session.user) {
            return res.redirect('/dashboard');
        }
        res.render('login', { 
            title: 'Iniciar Sesión | Cygnus',
            error: null 
        });
    },

    // Procesar credenciales (POST)
    login: async (req, res) => {
        // Limpieza básica de inputs
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        if (!email || !password) {
            req.flash('error', 'Por favor ingresa correo y contraseña.');
            return res.redirect('/login');
        }

        try {
            // PASO A: Autenticar contra Supabase Auth (Seguridad Real)
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (authError) {
                console.error("Error Auth Supabase:", authError.message);
                req.flash('error', 'Credenciales incorrectas o usuario no registrado.');
                return res.redirect('/login');
            }

            // PASO B: Buscar datos del perfil en tu tabla pública 'users'
            const { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (dbError || !user) {
                // Caso raro: Existe en Auth pero no en tu tabla de usuarios
                await supabase.auth.signOut();
                req.flash('error', 'Usuario autenticado pero sin perfil activo. Contacte a Gerencia.');
                return res.redirect('/login');
            }

            // PASO C: Crear la sesión (Estructura Original Recuperada)
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url || null, // Recuperamos la foto
                position: user.position || 'Agente'
            };

            // PASO D: Registrar actividad (Tu Logger Original)
            try {
                await logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión en el sistema');
            } catch (logErr) {
                console.error("Error logging activity:", logErr);
            }

            // PASO E: Éxito
            req.flash('success', `Bienvenido, ${user.name}`);
            res.redirect('/dashboard');

        } catch (err) {
            console.error("Login Controller Error:", err);
            req.flash('error', 'Ocurrió un error interno. Intenta más tarde.');
            res.redirect('/login');
        }
    },

    // =========================================================================
    // 2. RECUPERACIÓN DE CONTRASEÑA (Solicitud)
    // =========================================================================

    recoverPassword: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

        if (!email) {
            req.flash('error', 'Ingresa un correo válido.');
            return res.redirect('/login');
        }

        try {
            // 1. Verificamos si existe en la BD local para obtener el nombre
            const { data: user } = await supabase
                .from('users')
                .select('name')
                .eq('email', email)
                .single();
            
            // Si no existe, fingimos éxito por seguridad
            if (!user) {
                req.flash('success', 'Si el correo existe, recibirás instrucciones.');
                return res.redirect('/login');
            }

            if (!supabaseAdmin) {
                console.error("Falta SERVICE_ROLE_KEY en .env");
                req.flash('error', 'Error de configuración del servidor.');
                return res.redirect('/login');
            }

            // 2. Generar Link Mágico
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: {
                    redirectTo: `${req.protocol}://${req.get('host')}/update-password` 
                }
            });

            if (linkError) throw linkError;

            // 3. Enviar Correo (Diseño Profesional)
            const resetLink = linkData.properties.action_link;
            const htmlContent = `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; padding: 40px 20px;">
                    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="background: #2563eb; padding: 24px; text-align: center;">
                            <h2 style="color: white; margin: 0; font-size: 22px;">Restablecer Contraseña</h2>
                        </div>
                        <div style="padding: 40px;">
                            <p style="color: #334155; font-size: 16px; margin-bottom: 24px;">Hola <strong>${user.name}</strong>,</p>
                            <p style="color: #475569; font-size: 15px; line-height: 1.6;">Recibimos una solicitud para recuperar tu acceso al sistema Cygnus. Si fuiste tú, haz clic en el botón de abajo:</p>
                            
                            <div style="text-align: center; margin: 32px 0;">
                                <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 600; display: inline-block; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);">
                                    Crear Nueva Clave
                                </a>
                            </div>

                            <p style="color: #94a3b8; font-size: 13px; text-align: center;">Este enlace expira en 60 minutos.</p>
                        </div>
                    </div>
                </div>
            `;

            await sendEmail(email, 'Recuperar Acceso - Cygnus Group', htmlContent);

            req.flash('success', 'Correo enviado. Revisa tu bandeja de entrada.');
            res.redirect('/login');

        } catch (err) {
            console.error("Recovery Error:", err);
            req.flash('error', 'No se pudo procesar la solicitud.');
            res.redirect('/login');
        }
    },

    // =========================================================================
    // 3. CAMBIO DE CONTRASEÑA (Desde el enlace)
    // =========================================================================

    // Vista del formulario (GET)
    showUpdatePassword: (req, res) => {
        // Enviamos las claves públicas para que el frontend pueda verificar el token
        res.render('update-password', { 
            title: 'Nueva Contraseña | Cygnus',
            error: null,
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY
        });
    },

    // Procesar cambio (POST)
    updatePassword: async (req, res) => {
        const { password, accessToken } = req.body;

        if (!password || password.length < 6) {
            req.flash('error', 'La contraseña debe tener al menos 6 caracteres.');
            return res.redirect('/update-password');
        }

        try {
            let userIdToUpdate = null;

            // A. Intentamos obtener el usuario desde el Token del correo
            if (accessToken) {
                const { data: { user }, error } = await supabase.auth.getUser(accessToken);
                if (user && !error) userIdToUpdate = user.id;
            } 
            // B. Si no hay token, intentamos ver si hay sesión activa (fallback)
            else if (req.session.user) {
                userIdToUpdate = req.session.user.id;
            }

            if (!userIdToUpdate) throw new Error("Enlace inválido o expirado.");

            // C. Actualizar usando ADMIN (Infalible)
            if (supabaseAdmin) {
                await supabaseAdmin.auth.admin.updateUserById(userIdToUpdate, { password: password });
            } else {
                // Fallback para desarrollo
                await supabase.auth.updateUser({ password: password });
            }

            // D. Sincronizar campo 'password' en tabla pública (para referencia visual)
            await supabase.from('users').update({ password: password }).eq('id', userIdToUpdate);

            // E. Limpieza de seguridad
            await supabase.auth.signOut();
            req.session.destroy();

            // F. Login con éxito
            res.render('login', { 
                title: 'Iniciar Sesión', 
                error: null,
                successMessage: '¡Contraseña actualizada con éxito! Por favor inicia sesión.'
            });

        } catch (error) {
            console.error("Update Password Error:", error);
            req.flash('error', 'El enlace ha expirado. Solicita uno nuevo.');
            res.redirect('/login');
        }
    },

    // =========================================================================
    // 4. CERRAR SESIÓN
    // =========================================================================
    logout: async (req, res) => {
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.error("Supabase Logout Error:", e);
        }
        
        req.session.destroy((err) => {
            if (err) console.error("Session Destroy Error:", err);
            res.redirect('/login');
        });
    }
};

module.exports = authController;