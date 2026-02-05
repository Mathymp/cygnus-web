// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const bcrypt = require('bcryptjs');
const logActivity = require('../helpers/logger'); // Importamos el logger

const authController = {
    // 1. Formulario de Login (GET)
    loginForm: (req, res) => {
        // Si ya hay sesión, al dashboard
        if (req.session.user) {
            return res.redirect('/dashboard');
        }
        res.render('login', { title: 'Login | Cygnus' });
    },

    // 2. Procesar Login (POST)
    login: async (req, res) => {
        const { email, password } = req.body;

        try {
            // Buscar usuario
            const { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('email', email)
                .single();

            if (error || !user) {
                req.flash('error', 'Usuario no encontrado.');
                return res.redirect('/login');
            }

            // Verificar contraseña
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                req.flash('error', 'Contraseña incorrecta.');
                return res.redirect('/login');
            }

            // Crear sesión
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url
            };

            // --- REGISTRAR ACTIVIDAD (LOGIN) ---
            await logActivity(
                user.id, 
                user.name, 
                'login', 
                'sesion', 
                'Inició sesión en el sistema'
            );

            req.flash('success', `Bienvenido, ${user.name}`);
            res.redirect('/dashboard');

        } catch (err) {
            console.error(err);
            req.flash('error', 'Error de servidor.');
            res.redirect('/login');
        }
    }
};

module.exports = authController;