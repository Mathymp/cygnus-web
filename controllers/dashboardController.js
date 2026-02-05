const supabase = require('../config/supabaseClient');

const dashboardController = {
    getDashboard: async (req, res) => {
        // Variables para la vista
        let properties = [];
        let activityLogs = []; // AQUÍ guardaremos los logs reales
        let totalProperties = 0; 

        try {
            // 1. Obtener Propiedades Recientes (Para la tabla - Máx 5)
            const { data: propsData, error: propsError } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            if (propsError) {
                console.error("❌ Error cargando tabla dashboard:", propsError.message);
            } else if (propsData) {
                properties = propsData; 
            }

            // 2. OBTENER LOGS DE ACTIVIDAD REALES (NUEVO)
            const { data: logsData, error: logsError } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10); // Traemos los últimos 10 movimientos

            if (logsData) {
                activityLogs = logsData;
            }

            // 3. Obtener el total real de Propiedades (Para el KPI)
            const { count, error: countError } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true }); 

            if (!countError) {
                totalProperties = count;
            }

        } catch (error) {
            console.error('❌ Error General Dashboard:', error);
        }

        // 4. Renderizar
        res.render('dashboard', {
            title: 'Panel ERP | Cygnus',
            page: 'dashboard',
            user: req.session.user,
            
            // Datos específicos de esta vista
            activityLogs,   // Pasamos los logs reales a la vista
            properties,     
            totalProperties 
        });
    }
};

module.exports = dashboardController;