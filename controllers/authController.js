// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');

const authController = {
    
    // 1. Formulario de Login (GET)
    loginForm: (req, res) => {
        if (req.session.user) {
            return res.redirect('/dashboard');
        }
        res.render('login', { 
            title: 'Iniciar Sesión | Cygnus',
            error: null // El error se maneja principalmente por flash, pero esto asegura compatibilidad
        });
    },

    // 2. Procesar Login (POST)
    login: async (req, res) => {
        // Corrección: Forzar minúsculas y limpiar espacios para evitar errores de tipeo
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        if (!email || !password) {
            req.flash('error', 'Por favor ingresa correo y contraseña.');
            return res.redirect('/login');
        }

        try {
            // PASO 1: Autenticar con Supabase Auth (La fuente de verdad)
            // Esto verifica la contraseña real encriptada en el sistema de Auth
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (authError) {
                console.error("Error Auth Supabase:", authError.message);
                req.flash('error', 'Credenciales incorrectas o usuario no registrado.');
                return res.redirect('/login');
            }

            // PASO 2: Si el login es correcto, buscamos los datos del perfil en la tabla pública 'users'
            const { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (dbError || !user) {
                // Caso raro: Existe en Auth pero se borró de la tabla users
                await supabase.auth.signOut(); // Cerramos la sesión de Auth
                req.flash('error', 'Usuario autenticado pero sin perfil activo. Contacte soporte.');
                return res.redirect('/login');
            }

            // PASO 3: Crear la sesión del servidor
            // Mantenemos toda la estructura de datos que usas en tu app
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url || null,
                position: user.position || 'Agente'
            };

            // PASO 4: Registrar actividad
            try {
                await logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión en el sistema');
            } catch (logErr) {
                console.error("Error logging activity:", logErr);
            }

            // PASO 5: Redirección exitosa
            req.flash('success', `Bienvenido, ${user.name}`);
            res.redirect('/dashboard');

        } catch (err) {
            console.error("Login Controller Error:", err);
            req.flash('error', 'Ocurrió un error interno. Intenta más tarde.');
            res.redirect('/login');
        }
    },

    // 3. Logout
    logout: async (req, res) => {
        // Cerramos sesión en Supabase y destruimos la del servidor
        await supabase.auth.signOut();
        req.session.destroy((err) => {
            if (err) console.error("Logout Error:", err);
            res.redirect('/login');
        });
    }
};

module.exports = authController;