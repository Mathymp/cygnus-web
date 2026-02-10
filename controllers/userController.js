// Archivo: controllers/userController.js
const supabase = require('../config/supabaseClient');
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURACIÓN DE CLIENTE ADMIN (Service Role) ---
// INDISPENSABLE: Permite modificar contraseñas de otros y saltarse reglas de seguridad
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const userController = {

    // =========================================================================
    // 1. LISTAR EQUIPO
    // =========================================================================
    manageTeam: async (req, res) => {
        try {
            // Usamos cliente normal o admin, lo importante es leer
            const client = supabaseAdmin || supabase;
            const { data: users, error } = await client
                .from('users')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;

            res.render('admin/team-list', {
                title: 'Gestión de Equipo | Admin',
                page: 'equipo',
                user: req.session.user,
                agents: users || [],
                error: null,
                successMessage: null
            });
        } catch (error) {
            console.error("Error cargando equipo:", error);
            res.redirect('/dashboard');
        }
    },

    // =========================================================================
    // 2. FORMULARIO CREAR
    // =========================================================================
    addAgentForm: (req, res) => {
        res.render('admin/add-agent', {
            title: 'Nuevo Agente',
            page: 'equipo',
            user: req.session.user,
            error: null,
            successMessage: null,
            formData: {}
        });
    },

    // =========================================================================
    // 3. CREAR AGENTE (Blindado Anti-Zombies)
    // =========================================================================
    addAgent: async (req, res) => {
        try {
            const { name, email, password, phone, position, role } = req.body;
            const finalEmail = email.trim().toLowerCase();

            if (!finalEmail || !password || !name) throw new Error("Faltan datos obligatorios.");
            if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");

            let authData, authError;

            // PASO 1: Crear en Sistema de Seguridad (Auth)
            if (supabaseAdmin) {
                // Admin: Crea usuario YA CONFIRMADO (sin esperar email) -> Login inmediato
                const result = await supabaseAdmin.auth.admin.createUser({
                    email: finalEmail,
                    password: password,
                    email_confirm: true, // ¡Vital! Auto-confirma el correo
                    user_metadata: { name: name, role: role || 'corredor' }
                });
                authData = result.data;
                authError = result.error;
            } else {
                // Público: Envía correo de confirmación (peor UX para admins)
                const tempSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
                const result = await tempSupabase.auth.signUp({
                    email: finalEmail,
                    password: password,
                    options: { data: { name: name, role: role || 'corredor' } }
                });
                authData = result.data;
                authError = result.error;
            }

            if (authError) throw new Error(`Error Auth: ${authError.message}`);
            if (!authData.user) throw new Error("No se pudo crear usuario en Auth.");

            // PASO 2: Sincronizar DB Pública (Anti-Zombies)
            const clientToUse = supabaseAdmin || supabase;
            const newUserId = authData.user.id;

            // Upsert: Si el email existe (zombie), actualiza. Si no, crea.
            const { error: dbError } = await clientToUse
                .from('users')
                .upsert({
                    id: newUserId,
                    email: finalEmail,
                    name: name,
                    password: password, // Pass real para referencia y NOT NULL
                    phone: phone || null,
                    role: role || 'corredor',
                    position: position || 'Agente Inmobiliario',
                    created_at: new Date()
                    // REMOVIDO updated_at para evitar tu error de esquema
                }, { onConflict: 'email' }); 

            if (dbError) {
                console.error("❌ Error DB:", dbError);
                // Si falla la DB, borramos el Auth para que no quede corrupto
                if (supabaseAdmin) await supabaseAdmin.auth.admin.deleteUser(newUserId);
                throw new Error("Error sincronizando base de datos.");
            }

            res.render('admin/add-agent', {
                title: 'Nuevo Agente',
                page: 'equipo',
                user: req.session.user,
                error: null,
                successMessage: `Agente ${name} creado correctamente.`,
                formData: {}
            });

        } catch (error) {
            console.error("Error Add Agent:", error);
            res.render('admin/add-agent', {
                title: 'Nuevo Agente',
                page: 'equipo',
                user: req.session.user,
                error: "Error: " + error.message,
                successMessage: null,
                formData: req.body 
            });
        }
    },

    // =========================================================================
    // 4. FORMULARIO EDITAR
    // =========================================================================
    editAgentForm: async (req, res) => {
        try {
            const { id } = req.params;
            const { data: agent, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', id)
                .single();

            if (error || !agent) throw new Error("Agente no encontrado");

            res.render('admin/edit-agent', {
                title: 'Editar Agente',
                page: 'equipo',
                user: req.session.user,
                agent: agent,
                error: null,
                successMessage: null
            });
        } catch (error) {
            res.redirect('/admin/team');
        }
    },

    // =========================================================================
    // 5. ACTUALIZAR AGENTE (Cambio de Contraseña REAL)
    // =========================================================================
    updateAgent: async (req, res) => {
        try {
            const { id, name, phone, position, password, role } = req.body; 
            
            // Datos básicos para DB
            let updateData = { 
                name, 
                phone, 
                position,
                role: role || 'corredor'
            };

            // ¿El admin escribió una nueva contraseña?
            if (password && password.trim().length > 0) {
                if(password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");

                // 1. Agregamos la pass al objeto para actualizar la DB (Referencia)
                updateData.password = password;

                // 2. ACTUALIZACIÓN CRÍTICA EN AUTH (Esto permite el LOGIN)
                if (supabaseAdmin) {
                    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, { 
                        password: password,
                        user_metadata: { name: name } // También sync nombre
                    });
                    
                    if (authErr) {
                        console.error("Error actualizando Auth:", authErr.message);
                        throw new Error("No se pudo actualizar la contraseña en el sistema de seguridad.");
                    }
                } else {
                    console.warn("⚠️ Faltan permisos de Admin (Service Role) para cambiar contraseña.");
                }
            } else {
                // Si no cambia pass, solo sync nombre en Auth
                if (supabaseAdmin) {
                    await supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: { name: name } });
                }
            }

            // 3. Ejecutar Update en DB Pública
            const clientToUse = supabaseAdmin || supabase;
            const { error } = await clientToUse
                .from('users')
                .update(updateData)
                .eq('id', id);

            if (error) throw error;
            
            // Recargar datos frescos
            const { data: updatedAgent } = await supabase.from('users').select('*').eq('id', id).single();

            res.render('admin/edit-agent', {
                title: 'Editar Agente',
                page: 'equipo',
                user: req.session.user,
                agent: updatedAgent,
                error: null,
                successMessage: "Perfil y credenciales actualizados."
            });

        } catch (error) {
            console.error("Error Update:", error);
            const { data: agent } = await supabase.from('users').select('*').eq('id', req.body.id).single();
            
            res.render('admin/edit-agent', {
                title: 'Editar Agente',
                page: 'equipo',
                user: req.session.user,
                agent: agent || {},
                error: "Error: " + error.message,
                successMessage: null
            });
        }
    },

    // =========================================================================
    // 6. PERFIL AGENTE
    // =========================================================================
    agentProfile: async (req, res) => {
        try {
            const { id } = req.params;
            const { data: agent } = await supabase.from('users').select('*').eq('id', id).single();
            const { data: props } = await supabase.from('properties').select('*').eq('agent_id', id);

            res.render('admin/agent-profile', {
                title: `Perfil: ${agent.name}`,
                page: 'equipo',
                user: req.session.user,
                agent: agent,
                properties: props || []
            });
        } catch (error) {
            res.redirect('/admin/team');
        }
    },

    // =========================================================================
    // 7. ELIMINAR AGENTE (Propiedades -> Empresa/NULL)
    // =========================================================================
    deleteAgent: async (req, res) => {
        try {
            const { id } = req.params;
            const clientToUse = supabaseAdmin || supabase;

            // 1. "Liberar" Propiedades -> Set agent_id = NULL
            // Esto hace que en la web salgan con los datos de la EMPRESA
            console.log(`📦 Liberando propiedades del agente ${id} a la Empresa...`);
            
            const { error: releaseError } = await clientToUse
                .from('properties')
                .update({ agent_id: null }) // <--- ¡AQUÍ ESTÁ LA CLAVE!
                .eq('agent_id', id);

            if (releaseError) {
                console.error("Error liberando propiedades:", releaseError);
                throw new Error("Error al desvincular propiedades.");
            }

            // 2. Borrar de DB Pública
            const { error: dbError } = await clientToUse.from('users').delete().eq('id', id);
            if (dbError) throw dbError;

            // 3. Borrar de Auth (Bloqueo definitivo de Login)
            if (supabaseAdmin) {
                await supabaseAdmin.auth.admin.deleteUser(id);
                console.log(`🗑️ Usuario ${id} eliminado de Auth y DB.`);
            }

            res.json({ success: true, message: 'Agente eliminado. Propiedades transferidas a la empresa.' });

        } catch (error) {
            console.error("Error Delete:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },
    
    // =========================================================================
    // 8. LISTADO PÚBLICO
    // =========================================================================
    listAgents: async (req, res) => {
        try {
            const { data: agents } = await supabase
                .from('users')
                .select('*')
                .order('created_at', { ascending: false });

            res.render('agents', {
                title: 'Nuestros Agentes',
                page: 'agentes',
                user: req.session.user || null,
                agents: agents || []
            });
        } catch (e) {
            res.redirect('/');
        }
    }
};

module.exports = userController;