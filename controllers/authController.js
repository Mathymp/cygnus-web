// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const bcrypt = require('bcryptjs');
const logActivity = require('../helpers/logger');

const authController = {
    // 1. Formulario de Login (GET)
    loginForm: (req, res) => {
        if (req.session.user) {
            return res.redirect('/dashboard');
        }
        res.render('login', { title: 'Login | Cygnus' });
    },

    // 2. Procesar Login (POST)
    login: async (req, res) => {
        // CORRECCIÓN: Convertir a minúsculas y quitar espacios
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        if (!email || !password) {
            req.flash('error', 'Por favor ingresa correo y contraseña.');
            return res.redirect('/login');
        }

        try {
            // Buscamos el usuario por email (en minúsculas)
            const { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('email', email)
                .single();

            if (error || !user) {
                req.flash('error', 'Usuario no encontrado o credenciales inválidas.');
                return res.redirect('/login');
            }

            // Verificar contraseña
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                req.flash('error', 'Contraseña incorrecta.');
                return res.redirect('/login');
            }

            // Crear sesión (Mantenemos la estructura exacta para no romper otras páginas)
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                photo: user.photo_url
            };

            // Registrar actividad
            try {
                await logActivity(user.id, user.name, 'login', 'sesion', 'Inició sesión en el sistema');
            } catch (logErr) {
                console.error("Error logging activity:", logErr);
            }

            req.flash('success', `Bienvenido, ${user.name}`);
            res.redirect('/dashboard');

        } catch (err) {
            console.error("Login Error:", err);
            req.flash('error', 'Ocurrió un error en el servidor.');
            res.redirect('/login');
        }
    },

    // 3. Logout
    logout: (req, res) => {
        req.session.destroy((err) => {
            if (err) console.error("Logout Error:", err);
            res.redirect('/');
        });
    }
};

module.exports = authController;