const supabase = require('../config/supabaseClient');
// Necesitamos crear un cliente temporal para no cerrar la sesión del admin al crear otro usuario
const { createClient } = require('@supabase/supabase-js'); 

const userController = {

    // --- RENDERIZAR VISTA DE LISTA (EQUIPO) ---
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
                // CORRECCIÓN AQUÍ: La vista espera 'agents', no 'users'
                agents: users || [] 
            });
        } catch (error) {
            console.error("Error cargando equipo:", error);
            res.redirect('/dashboard');
        }
    },

    // --- RENDERIZAR FORMULARIO DE CREAR ---
    addAgentForm: (req, res) => {
        res.render('admin/add-agent', {
            title: 'Nuevo Agente',
            page: 'equipo',
            user: req.session.user,
            error: null,
            formData: {} // Para rellenar si falla
        });
    },

    // --- CREAR AGENTE (NO CIERRA SESIÓN ADMIN) ---
    addAgent: async (req, res) => {
        try {
            const { name, email, password, phone, position, role } = req.body;
            
            // 1. FORZAR MINÚSCULAS y limpiar espacios
            const finalEmail = email.trim().toLowerCase();

            // 2. CLIENTE TEMPORAL (Truco para no desloguear al Admin)
            const tempSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

            // 3. Crear usuario en Auth (Supabase) usando el cliente temporal
            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
                email: finalEmail,
                password: password
            });

            if (authError) throw authError;

            if (authData.user) {
                // 4. Crear registro en tabla pública 'users' (Usamos cliente principal)
                const { error: dbError } = await supabase
                    .from('users')
                    .insert([{
                        id: authData.user.id,
                        name: name,
                        email: finalEmail,
                        phone: phone,
                        role: role || 'agent', 
                        position: position || 'Agente Inmobiliario',
                        created_at: new Date()
                    }]);
                
                if (dbError) {
                    console.error("Error DB, rollback auth...", dbError);
                }
            }

            // ÉXITO: Redirigir a la lista del equipo
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

    // --- FORMULARIO DE EDICIÓN ---
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

    // --- ACTUALIZAR AGENTE ---
    updateAgent: async (req, res) => {
        try {
            const { id, name, phone, position } = req.body; 

            const { error } = await supabase
                .from('users')
                .update({ 
                    name, 
                    phone, 
                    position 
                })
                .eq('id', id);

            if (error) throw error;

            res.redirect('/admin/team');
        } catch (error) {
            console.error(error);
            res.redirect('/admin/team');
        }
    },

    // --- PERFIL DE AGENTE (VER) ---
    agentProfile: async (req, res) => {
        try {
            const { id } = req.params;
            
            // Datos del agente
            const { data: agent } = await supabase.from('users').select('*').eq('id', id).single();
            
            // Propiedades del agente
            const { data: props } = await supabase
                .from('properties')
                .select('*')
                .eq('agent_id', id);

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

    // --- ELIMINAR AGENTE ---
    deleteAgent: async (req, res) => {
        try {
            const { id } = req.params;

            // 1. Reasignar propiedades al Admin o Cuenta Corporativa antes de borrar
            const { data: adminUser } = await supabase
                .from('users')
                .select('id')
                .eq('role', 'admin')
                .limit(1)
                .single();
            
            if (adminUser) {
                await supabase
                    .from('properties')
                    .update({ agent_id: adminUser.id })
                    .eq('agent_id', id);
            }

            // 2. Eliminar de la tabla users (pública)
            const { error: dbError } = await supabase
                .from('users')
                .delete()
                .eq('id', id);

            if (dbError) throw dbError;

            res.json({ success: true });

        } catch (error) {
            console.error("Error eliminando agente:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },
    
    // --- LISTA PÚBLICA DE AGENTES ---
    listAgents: async (req, res) => {
        try {
            const { data: agents } = await supabase
                .from('users')
                .select('*')
                .eq('role', 'agent'); 

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