const supabase = require('../config/supabaseClient');
const bcrypt = require('bcryptjs');

// --- LISTAR EQUIPO (Vista Principal) ---
exports.manageTeam = async (req, res) => {
    try {
        const { data: agents, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // CORRECCIÓN: Usamos '' (string vacío) en lugar de null para evitar crash en EJS
        let success = ''; 
        let errorMsg = '';

        if (req.query.status === 'created') success = 'Nuevo miembro registrado correctamente.';
        if (req.query.status === 'updated') success = 'Perfil del agente actualizado.';
        if (req.query.status === 'deleted') success = 'Agente eliminado y propiedades liberadas.';
        
        // Si hay error en la URL, lo capturamos
        if (req.query.error) errorMsg = req.query.error;

        res.render('admin/team-list', {
            title: 'Gestión de Equipo',
            page: 'team',
            user: req.session.user,
            agents: agents || [],
            success: success,
            error: errorMsg // Ahora enviamos '' si no hay error
        });
    } catch (err) {
        console.error('Error al obtener equipo:', err);
        res.status(500).send('Error del servidor al cargar el equipo.');
    }
};

// --- FORMULARIO CREAR AGENTE ---
exports.showCreateForm = (req, res) => {
    res.render('admin/add-agent', {
        title: 'Nuevo Agente',
        page: 'team',
        user: req.session.user,
        error: '', // String vacío
        success: '', // String vacío
        formData: {}
    });
};

// --- PROCESAR CREACIÓN DE AGENTE ---
exports.createAgent = async (req, res) => {
    let { name, email, password, phone, role, position } = req.body;
    const cleanPhone = phone ? phone.replace(/\s/g, '') : '';

    try {
        // Validaciones
        if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
        if (/\d/.test(name)) throw new Error("El nombre no puede contener números.");

        // Verificar duplicados
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', email)
            .single();

        if (existingUser) throw new Error('El correo electrónico ya está registrado.');

        // Crear usuario
        const hashedPassword = await bcrypt.hash(password, 10);

        const { error } = await supabase.from('users').insert([{
            name, email, password: hashedPassword, phone: cleanPhone, role, position, created_at: new Date()
        }]);

        if (error) throw error;

        res.redirect('/admin/team?status=created');

    } catch (err) {
        res.render('admin/add-agent', {
            title: 'Nuevo Agente',
            page: 'team',
            user: req.session.user,
            error: err.message || 'Error al crear el agente.',
            success: '',
            formData: req.body
        });
    }
};

// --- LISTAR AGENTES (JSON API) ---
exports.listAgents = async (req, res) => {
    try {
        const { data: agents } = await supabase.from('users').select('id, name, email, role').eq('role', 'agent');
        res.json(agents || []);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener lista de agentes' });
    }
};

// --- FORMULARIO EDITAR AGENTE ---
exports.showEditForm = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: agent, error } = await supabase.from('users').select('*').eq('id', id).single();

        if (error || !agent) return res.redirect('/admin/team');

        res.render('admin/edit-agent', {
            title: 'Editar Agente',
            page: 'team',
            user: req.session.user,
            agent: agent,
            error: '',
            success: ''
        });
    } catch (err) {
        console.error(err);
        res.redirect('/admin/team');
    }
};

// --- ACTUALIZAR AGENTE ---
exports.updateAgent = async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, role, position, password } = req.body;
    const cleanPhone = phone ? phone.replace(/\s/g, '') : '';

    try {
        const updates = { name, email, phone: cleanPhone, role, position };

        if (password && password.trim() !== '') {
            if (password.length < 6) throw new Error("La nueva contraseña es muy corta.");
            updates.password = await bcrypt.hash(password, 10);
        }

        const { error } = await supabase.from('users').update(updates).eq('id', id);

        if (error) throw error;

        res.redirect('/admin/team?status=updated');

    } catch (err) {
        res.render('admin/edit-agent', {
            title: 'Editar Agente',
            page: 'team',
            user: req.session.user,
            agent: { ...req.body, id },
            error: err.message || 'Error al actualizar el perfil.',
            success: ''
        });
    }
};

// --- ELIMINAR AGENTE ---
exports.deleteAgent = async (req, res) => {
    const { id } = req.params;

    if (req.session.user.id === id) {
        return res.redirect(`/admin/team?error=${encodeURIComponent("No puedes eliminar tu propia cuenta de administrador.")}`);
    }

    try {
        // Desvincular propiedades (quedan huerfanas/de la empresa)
        await supabase.from('properties').update({ agent_id: null }).eq('agent_id', id);

        // Eliminar usuario
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) throw error;

        res.redirect('/admin/team?status=deleted');

    } catch (err) {
        console.error('Error eliminando agente:', err);
        res.redirect(`/admin/team?error=${encodeURIComponent("Ocurrió un error al intentar eliminar al agente.")}`);
    }
};