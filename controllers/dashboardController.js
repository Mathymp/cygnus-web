// Archivo: controllers/dashboardController.js
const supabase = require('../config/supabaseClient');

const dashboardController = {
    getDashboard: async (req, res) => {
        // Variables iniciales para la vista
        let properties = [];
        let activityLogs = []; 
        let totalProperties = 0; 

        try {
            // =========================================================
            // 1. Obtener Propiedades Recientes (Para la tabla - Máx 5)
            // =========================================================
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

            // =========================================================
            // 2. OBTENER LOGS DE ACTIVIDAD (Con Conversión Horaria)
            // =========================================================
            const { data: logsData, error: logsError } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10); // Traemos los últimos 10 movimientos

            if (logsData) {
                // AQUÍ ESTÁ LA MAGIA: Convertimos la hora UTC a Hora Chile
                activityLogs = logsData.map(log => {
                    // Creamos fecha a partir del dato crudo
                    const utcDate = new Date(log.created_at);
                    
                    // La formateamos forzando la zona horaria de Santiago
                    const chileTime = utcDate.toLocaleString('es-CL', { 
                        timeZone: 'America/Santiago',
                        day: '2-digit', 
                        month: '2-digit', 
                        year: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false // Formato 24hrs (14:00) o true para (02:00 PM)
                    });

                    return {
                        ...log,
                        // Sobreescribimos created_at con el string ya formateado
                        // Así la vista lo mostrará directo sin tener que cambiar el EJS
                        created_at: chileTime 
                    };
                });
            }

            // =========================================================
            // 3. Obtener el total real de Propiedades (KPI)
            // =========================================================
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
            
            // Datos
            activityLogs,   // Ahora llevan la hora chilena
            properties,     
            totalProperties 
        });
    }
};

module.exports = dashboardController;