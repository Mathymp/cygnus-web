// Archivo: controllers/userController.js
const supabase = require('../config/supabaseClient');
const bcrypt = require('bcryptjs');

// --- 1. LISTAR AGENTES (Público) ---
// Esta función es vital para la ruta '/agentes'
exports.listAgents = async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('name');

        if (error) throw error;

        res.render('agents', {
            title: 'Nuestros Agentes',
            users: users || [],
            user: req.session.user || null
        });
    } catch (err) {
        console.error("Error al listar agentes:", err);
        res.redirect('/');
    }
};

// --- 2. GESTIÓN DE EQUIPO (Admin Dashboard) ---
exports.manageTeam = async (req, res) => {
    try {
        const { data: agents, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        let success = ''; 
        let errorMsg = '';

        if (req.query.status === 'created') success = 'Nuevo miembro registrado correctamente.';
        if (req.query.status === 'updated') success = 'Perfil del agente actualizado.';
        if (req.query.status === 'deleted') success = 'Agente eliminado y propiedades liberadas.';
        if (req.query.error) errorMsg = req.query.error;

        res.render('admin/team-list', {
            title: 'Gestión de Equipo',
            page: 'team',
            user: req.session.user,
            agents: agents || [],
            success: success,
            error: errorMsg 
        });
    } catch (err) {
        console.error('Error al obtener equipo:', err);
        res.status(500).send('Error del servidor al cargar equipo.');
    }
};

// --- 3. FORMULARIO NUEVO AGENTE ---
exports.addAgentForm = (req, res) => {
    res.render('admin/add-agent', {
        title: 'Agregar Agente',
        page: 'team',
        user: req.session.user,
        error: '',
        success: ''
    });
};

// --- 4. CREAR AGENTE (POST) ---
exports.addAgent = async (req, res) => {
    try {
        const { name, phone, password, role } = req.body;
        // CORRECCIÓN: Email siempre en minúsculas al crear
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

        // Validar si ya existe
        const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
        if (existing) {
            return res.render('admin/add-agent', {
                title: 'Agregar Agente',
                page: 'team',
                user: req.session.user,
                error: 'El correo ya está registrado.',
                success: ''
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const { error } = await supabase.from('users').insert([{
            name,
            email,
            phone,
            password: hashedPassword,
            role,
            created_at: new Date()
        }]);

        if (error) throw error;

        res.redirect('/admin/team?status=created');

    } catch (err) {
        console.error("Error creating agent:", err);
        res.render('admin/add-agent', {
            title: 'Agregar Agente',
            page: 'team',
            user: req.session.user,
            error: 'Error al crear el usuario.',
            success: ''
        });
    }
};

// --- 5. FORMULARIO EDITAR ---
exports.editAgentForm = async (req, res) => {
    exports.showEditForm(req, res); // Reutilizamos la lógica
};

// Función auxiliar para mostrar form de edición
exports.showEditForm = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: agent, error } = await supabase.from('users').select('*').eq('id', id).single();
        if (error || !agent) return res.redirect('/admin/team');

        res.render('admin/edit-agent', {
            title: 'Editar Agente',
            page: 'team',
            user: req.session.user,
            agent,
            error: '',
            success: ''
        });
    } catch (e) {
        res.redirect('/admin/team');
    }
};

// --- 6. ACTUALIZAR AGENTE (POST) ---
exports.updateAgent = async (req, res) => {
    const { id } = req.params;
    const { name, phone, password, role } = req.body;
    // CORRECCIÓN: Email en minúsculas al actualizar
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

    try {
        let updates = { name, email, phone, role };

        if (password && password.trim() !== "") {
            if (password.length < 6) throw new Error("La contraseña es muy corta.");
            updates.password = await bcrypt.hash(password, 10);
        }

        const { error } = await supabase.from('users').update(updates).eq('id', id);
        if (error) throw error;

        res.redirect('/admin/team?status=updated');

    } catch (err) {
        // En caso de error, volvemos a renderizar con los datos que intentó enviar
        res.render('admin/edit-agent', {
            title: 'Editar Agente',
            page: 'team',
            user: req.session.user,
            agent: { ...req.body, id },
            error: err.message || 'Error al actualizar.',
            success: ''
        });
    }
};

// --- 7. ELIMINAR AGENTE ---
exports.deleteAgent = async (req, res) => {
    const { id } = req.params;

    if (req.session.user.id === id) {
        return res.redirect(`/admin/team?error=${encodeURIComponent("No puedes eliminar tu propia cuenta.")}`);
    }

    try {
        await supabase.from('properties').update({ agent_id: null }).eq('agent_id', id);
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) throw error;

        res.redirect('/admin/team?status=deleted');
    } catch (err) {
        console.error("Error deleting agent:", err);
        res.redirect(`/admin/team?error=${encodeURIComponent("Error al eliminar agente.")}`);
    }
};

// --- 8. VER PERFIL (Para el botón "Ojo") ---
exports.agentProfile = async (req, res) => {
    // Reutilizamos el formulario de edición en modo lectura o normal
    return exports.showEditForm(req, res);
};