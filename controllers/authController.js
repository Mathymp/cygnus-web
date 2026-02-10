// Archivo: controllers/authController.js
const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger');
const sendEmail = require('../helpers/emailHelper'); 
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN CRÍTICA ---
const BASE_URL = 'https://www.cygnusgroup.cl';

// Cliente Admin (Service Role) - ¡PODER TOTAL!
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const authController = {
    
    // =========================================================================
    // 1. VISTA LOGIN
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
    // 2. PROCESAR LOGIN (AJAX) - ¡LÓGICA MAESTRA DE REPARACIÓN!
    // =========================================================================
    login: async (req, res) => {
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const { password } = req.body;

        const returnError = (field, msg) => {
            return res.status(400).json({ success: false, field, message: msg });
        };

        if (!email) return returnError('email', 'Por favor, ingresa tu correo.');
        if (!password) return returnError('password', 'Por favor, ingresa tu contraseña.');

        try {
            // A. Login Auth (Paso 1: ¿Es válida la credencial?)
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });

            if (authError) return returnError('password', 'Credenciales incorrectas o usuario no registrado.');

            // B. Gestión de Perfil en DB Pública (Paso 2: Sincronización)
            const clientToUse = supabaseAdmin || supabase;
            const newUserId = authData.user.id;
            
            // 1. Intentar buscar perfil por ID CORRECTO
            let { data: user } = await clientToUse
                .from('users')
                .select('*')
                .eq('id', newUserId)
                .single();

            // 2. Si NO existe el perfil por ID, entramos en MODO REPARACIÓN
            if (!user) {
                console.warn(`⚠️ Usuario ${email} (ID: ${newUserId}) autenticado en Auth pero sin perfil en DB.`);
                
                // 2.1 Buscar si existe un "Usuario Zombie" (Mismo email, ID viejo)
                const { data: zombieUser } = await clientToUse
                    .from('users')
                    .select('*')
                    .eq('email', email)
                    .single();

                // Datos base para el nuevo perfil (o migrado)
                const profileData = {
                    id: newUserId, // El ID nuevo y correcto de Auth
                    email: email,
                    // Heredamos nombre si existe, si no de metadata, si no del email
                    name: zombieUser?.name || authData.user.user_metadata?.name || email.split('@')[0], 
                    role: zombieUser?.role || 'corredor', 
                    position: zombieUser?.position || 'Agente Inmobiliario',
                    phone: zombieUser?.phone || null,
                    photo_url: zombieUser?.photo_url || null,
                    password: password, // Guardamos pass real para cumplir restricción NOT NULL
                    created_at: new Date(),
                    updated_at: new Date()
                };

                if (zombieUser) {
                    console.warn(`🧟 Detectado ZOMBIE (ID Viejo: ${zombieUser.id}). Iniciando Migración Quirúrgica...`);
                    
                    // A. MIGRAR PROPIEDADES (Reasignar al nuevo ID)
                    // Ajusta 'properties' y 'agent_id' si tus tablas se llaman distinto
                    const { error: propError } = await clientToUse
                        .from('properties')
                        .update({ agent_id: newUserId })
                        .eq('agent_id', zombieUser.id);
                    
                    if (propError) console.error("❌ Error migrando propiedades:", propError);
                    else console.log("✅ Propiedades reasignadas al nuevo ID.");

                    // B. ELIMINAR EL VIEJO (Ahora que está vacío)
                    await clientToUse.from('users').delete().eq('id', zombieUser.id);
                    console.log("🗑️ Usuario zombie eliminado.");
                }

                // 2.2 CREAR EL NUEVO PERFIL (Limpio y sincronizado)
                console.log(`🛠️ Creando perfil definitivo para ${email}...`);
                const { error: insertError } = await clientToUse.from('users').insert(profileData);
                
                if (insertError) {
                    console.error("❌ Falló creación de perfil:", insertError);
                    await supabase.auth.signOut();
                    return returnError('email', 'Error crítico de base de datos. Contacta a soporte.');
                }
                
                user = profileData; // Asignamos el nuevo perfil para la sesión
                console.log("✨ Perfil sincronizado exitosamente.");

            } else {
                // 3. Mantenimiento Preventivo (Si ya existía y está bien)
                // Si la contraseña cambió, la actualizamos en public users para mantener consistencia
                if (user.password !== password) {
                    await clientToUse.from('users').update({ password: password }).eq('id', user.id);
                }
            }

            // --- VALIDACIÓN FINAL ---
            if (!user || !user.id) {
                throw new Error("El usuario es nulo después del proceso.");
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
                return res.json({ success: true, message: 'Si el correo existe, enviamos instrucciones.' });
            }

            if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Error config servidor.' });

            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email: email,
                options: { redirectTo: `${BASE_URL}/update-password` }
            });

            if (linkError) throw linkError;

            const htmlMessage = `<p>Hola <strong>${user.name}</strong>,</p><p>Recupera tu acceso aquí:</p>`;
            
            await sendEmail(
                email, 'Restablecer Clave 🔒', 'Recuperación', 
                htmlMessage, 'Nueva Clave', linkData.properties.action_link
            );

            return res.json({ success: true, message: 'Correo enviado.' });

        } catch (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Error interno.' });
        }
    },

    // 4. VISTA UPDATE
    showUpdatePassword: (req, res) => {
        res.render('update-password', { 
            title: 'Nueva Contraseña', 
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY 
        });
    },

    // 5. PROCESO UPDATE (Con Upsert inteligente para cubrir todos los casos)
    updatePassword: async (req, res) => {
        const { password, accessToken } = req.body;
        const sendError = (msg) => res.status(400).json({ success: false, message: msg });

        if (!password || password.length < 6) return sendError('Mínimo 6 caracteres.');
        if (!accessToken) return sendError('Link inválido.');

        try {
            // 1. Validar Token
            const { data: { user }, error } = await supabase.auth.getUser(accessToken);
            if (error || !user) return sendError('Link expirado.');

            const client = supabaseAdmin || supabase;

            // 2. Actualizar Auth (La fuente de verdad)
            if (supabaseAdmin) await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
            else await supabase.auth.updateUser({ password });

            // 3. Actualizar DB Pública (Upsert: Crea si no existe, Actualiza si existe)
            // Esto arregla perfiles que falten al momento de recuperar contraseña
            await client.from('users').upsert({ 
                id: user.id,
                email: user.email,
                password: password, // Sincronizamos pass
                name: user.user_metadata?.name || user.email.split('@')[0],
                role: 'corredor', // Default si se crea nuevo
                updated_at: new Date()
            }, { onConflict: 'id' });

            // 4. Salir
            await supabase.auth.signOut();
            req.session.destroy();

            return res.json({ success: true, message: 'Actualizado.', redirect: '/login' });

        } catch (error) {
            console.error(error);
            return sendError('Error interno.');
        }
    },

    logout: async (req, res) => {
        await supabase.auth.signOut();
        req.session.destroy(() => res.redirect('/login'));
    }
};

module.exports = authController;