const supabase = require('../config/supabaseClient');
const { createClient } = require('@supabase/supabase-js'); 

const userController = {

    // --- LISTAR EQUIPO ---
    manageTeam: async (req, res) => {
        try {
            const { data: users, error } = await supabase
                .from('users')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;

            res.render('admin/team-list', {
                title: 'Gestión de Equipo',
                page: 'equipo',
                user: req.session.user,
                agents: users || [] 
            });
        } catch (error) {
            console.error("Error cargando equipo:", error);
            res.redirect('/dashboard');
        }
    },

    // --- FORMULARIO CREAR ---
    addAgentForm: (req, res) => {
        res.render('admin/add-agent', {
            title: 'Nuevo Agente',
            page: 'equipo',
            user: req.session.user,
            error: null,
            formData: {}
        });
    },

    // --- CREAR AGENTE ---
    addAgent: async (req, res) => {
        try {
            const { name, email, password, phone, position, role } = req.body;
            const finalEmail = email.trim().toLowerCase();

            // Cliente temporal para crear en Auth sin cerrar sesión Admin
            const tempSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
                email: finalEmail,
                password: password
            });

            if (authError) throw authError;

            if (authData.user) {
                const { error: dbError } = await supabase
                    .from('users')
                    .insert([{
                        id: authData.user.id,
                        name: name,
                        email: finalEmail,
                        password: password, // Guardamos referencia
                        phone: phone,
                        role: role || 'agent',
                        position: position || 'Agente Inmobiliario',
                        created_at: new Date()
                    }]);
                
                if (dbError) console.error("Error DB rollback:", dbError);
            }

            res.redirect('/admin/team');

        } catch (error) {
            console.error("Error creando agente:", error);
            res.render('admin/add-agent', {
                title: 'Nuevo Agente',
                page: 'equipo',
                user: req.session.user,
                error: "Error al crear: " + error.message,
                formData: req.body 
            });
        }
    },

    // --- FORMULARIO EDITAR ---
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
                error: null
            });
        } catch (error) {
            console.error(error);
            res.redirect('/admin/team');
        }
    },

    // --- ACTUALIZAR AGENTE (CON CAMBIO DE CONTRASEÑA) ---
    updateAgent: async (req, res) => {
        try {
            const { id, name, phone, position, password } = req.body; 
            
            // 1. Objeto base de actualización para la BD
            let updateData = { 
                name, 
                phone, 
                position 
            };

            // 2. Si el admin escribió una nueva contraseña...
            if (password && password.trim().length > 0) {
                if(password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");

                // A) Actualizar en Supabase Auth (Sistema de Login)
                // Necesitamos usar service_role para cambiar pass de otro usuario, 
                // PERO como workaround usaremos update en la tabla y asumimos que el usuario
                // deberá usar "Olvidé mi contraseña" o el admin recrearlo si Auth falla.
                // *MEJOR OPCIÓN SI TIENES SERVICE_KEY*: 
                // const adminAuth = createClient(URL, SERVICE_KEY); await adminAuth.auth.admin.updateUserById(id, {password})
                
                // Como probablemente no tengas la SERVICE_KEY configurada a mano aquí,
                // actualizamos solo la BD local para referencia visual.
                // Si quieres que el login funcione con la nueva pass, el usuario nuevo DEBE coincidir.
                
                // INTENTO DE ACTUALIZAR AUTH (Solo funciona si eres el mismo usuario o tienes service_role)
                // Para simplificar tu caso: Solo actualizamos los datos visuales y la pass en BD.
                // Si la pass de Auth no coincide, hay que borrar y crear de nuevo o usar Recover.
                
                // P.D: Para que FUNCIONE el cambio de pass real de otro usuario, se necesita la SERVICE_ROLE_KEY.
                // Si no la tienes, el login seguirá usando la vieja.
                
                updateData.password = password; 
            }

            // 3. Actualizar en Tabla 'users'
            const { error } = await supabase
                .from('users')
                .update(updateData)
                .eq('id', id);

            if (error) throw error;
            
            // 4. TRUCO: Si cambiaste la pass, intentamos actualizarla en Auth usando una instancia Admin
            // Esto requiere que process.env.SUPABASE_SERVICE_ROLE_KEY esté en tu .env
            // Si no está, este bloque fallará silenciosamente o lo ignoramos.
            if (password && password.trim().length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
                const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
                await supabaseAdmin.auth.admin.updateUserById(id, { password: password });
            }

            res.redirect('/admin/team');

        } catch (error) {
            console.error("Error actualizando:", error);
            // Volver a cargar la vista con el error
            const { data: agent } = await supabase.from('users').select('*').eq('id', req.body.id).single();
            res.render('admin/edit-agent', {
                title: 'Editar Agente',
                page: 'equipo',
                user: req.session.user,
                agent: agent || {},
                error: "Error al actualizar: " + error.message
            });
        }
    },

    // --- PERFIL Y BORRAR (Igual que antes) ---
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

    deleteAgent: async (req, res) => {
        try {
            const { id } = req.params;
            const { data: adminUser } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).single();
            
            if (adminUser) {
                await supabase.from('properties').update({ agent_id: adminUser.id }).eq('agent_id', id);
            }

            const { error: dbError } = await supabase.from('users').delete().eq('id', id);
            if (dbError) throw dbError;

            // Intento de borrar de Auth si existe la key
            if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
                const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
                await supabaseAdmin.auth.admin.deleteUser(id);
            }

            res.json({ success: true });
        } catch (error) {
            console.error("Error eliminando agente:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },
    
    listAgents: async (req, res) => {
        try {
            const { data: agents } = await supabase.from('users').select('*').eq('role', 'agent'); 
            res.render('agents', {
                title: 'Nuestros Agentes',
                page: 'agentes',
                user: req.session.user || null,
                agents: agents || []
            });
        } catch (e) {
            console.error(e);
            res.redirect('/');
        }
    }
};

module.exports = userController;