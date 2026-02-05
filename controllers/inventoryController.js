const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger'); // Importamos logger para registrar la acción

const inventoryController = {
    
    // --- 1. MOSTRAR INVENTARIO ---
    getInventory: async (req, res) => {
        try {
            // 1. SEGURIDAD: Validar sesión
            if (!req.session || !req.session.user) {
                return res.redirect('/');
            }

            const user = req.session.user;
            const { search, operacion, categoria, estado, orden, agente } = req.query;

            // 2. QUERY BASE
            let query = supabase
                .from('properties')
                .select(`*, agent:users ( name, id, role )`) 
                .order('created_at', { ascending: false });

            // 3. FILTROS
            if (search) {
                query = query.or(`title.ilike.%${search}%,address_commune.ilike.%${search}%,address_street.ilike.%${search}%`);
            }
            if (operacion) query = query.eq('operation_type', operacion);
            if (categoria) query = query.eq('category', categoria);
            if (estado) query = query.eq('status', estado);
            
            // Filtro por Agente
            if (agente) query = query.eq('agent_id', agente);

            const { data: rawProperties, error } = await query;
            if (error) throw error;

            let properties = rawProperties || [];

            // 4. ORDENAMIENTO
            if (orden === 'precio_asc') {
                properties.sort((a, b) => a.price - b.price);
            } else if (orden === 'precio_desc') {
                properties.sort((a, b) => b.price - a.price);
            } else if (orden === 'antiguas') {
                properties.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            } else {
                // Orden por defecto: Mis propiedades primero (Admin o Agente)
                if (user.role !== 'admin') {
                    properties.sort((a, b) => {
                        const isMineA = a.agent_id === user.id;
                        const isMineB = b.agent_id === user.id;
                        if (isMineA && !isMineB) return -1;
                        if (!isMineA && isMineB) return 1;
                        return 0;
                    });
                }
            }

            // 5. LISTA DE AGENTES (Para Reasignar)
            let agentsList = [];
            if (user.role === 'admin') {
                const { data: agents } = await supabase
                    .from('users')
                    .select('id, name, role')
                    .neq('role', 'admin') 
                    .order('name'); 
                agentsList = agents || [];
            }

            // 6. RENDERIZADO
            res.render('admin/propiedades', { 
                title: 'Inventario', 
                page: 'propiedades', 
                user: user,
                properties: properties, 
                agentsList: agentsList,
                query: req.query 
            });

        } catch (error) {
            console.error("Error crítico en Inventario:", error);
            res.render('admin/propiedades', {
                title: 'Error',
                page: 'propiedades',
                user: req.session.user || { role: 'guest' },
                properties: [],
                agentsList: [],
                query: {},
                error: "Error al cargar el inventario."
            });
        }
    },

    // --- 2. REASIGNAR AGENTE (NUEVA FUNCIÓN AQUÍ) ---
    reassignAgent: async (req, res) => {
        try {
            let { propertyId, newAgentId } = req.body;
            
            // LÓGICA CLAVE: Si viene vacío, lo forzamos a NULL (Cuenta Corporativa)
            if (!newAgentId || newAgentId.trim() === '') {
                newAgentId = null;
            }

            const { error } = await supabase
                .from('properties')
                .update({ agent_id: newAgentId })
                .eq('id', propertyId);

            if (error) throw error;

            // Registrar Actividad
            const actionText = newAgentId ? `a agente ID: ${newAgentId}` : 'a Cuenta Corporativa (Sin Agente)';
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                'update',
                'asignacion',
                `Reasignó propiedad ${propertyId} ${actionText}`
            );

            res.redirect('/admin/propiedades');
        } catch (e) {
            console.error("Error al reasignar:", e);
            res.redirect('/admin/propiedades');
        }
    }
};

module.exports = inventoryController;