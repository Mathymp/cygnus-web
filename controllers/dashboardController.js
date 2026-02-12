// Archivo: controllers/dashboardController.js
const supabase = require('../config/supabaseClient');

// Función auxiliar para formatear fecha a Chile (DD/MM/YYYY HH:mm)
const formatDateChile = (utcDateString) => {
    if (!utcDateString) return 'Fecha inválida';
    
    const date = new Date(utcDateString);
    
    // Usamos Intl.DateTimeFormat que es nativo y robusto para zonas horarias
    const options = { 
        timeZone: 'America/Santiago', 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    };
    
    // Esto devuelve algo como "12/02/2026, 18:30"
    // Lo limpiamos para que quede "12/02/2026 18:30"
    return new Intl.DateTimeFormat('es-CL', options).format(date).replace(',', '');
};

const dashboardController = {
    getDashboard: async (req, res) => {
        let properties = [];
        let activityLogs = []; 
        let totalProperties = 0; 
        let ufValue = '---'; // Valor por defecto

        try {
            // =========================================================
            // 1. OBTENER UF (Indicador Económico)
            // =========================================================
            try {
                const response = await fetch('https://mindicador.cl/api/uf');
                if (response.ok) {
                    const data = await response.json();
                    if (data.serie && data.serie.length > 0) {
                        // Formateamos a pesos chilenos (ej: $38.000,00)
                        ufValue = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(data.serie[0].valor);
                    }
                }
            } catch (ufError) {
                console.error("⚠️ Error obteniendo UF:", ufError.message);
                // Si falla, mostramos un valor guardado o '---'
            }

            // =========================================================
            // 2. OBTENER LOGS DE ACTIVIDAD (Formato Chile Forzado)
            // =========================================================
            const { data: logsData, error: logsError } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (logsData) {
                activityLogs = logsData.map(log => ({
                    ...log,
                    // AQUÍ APLICAMOS LA CORRECCIÓN
                    created_at: formatDateChile(log.created_at)
                }));
            }

            // =========================================================
            // 3. OBTENER PROPIEDADES RECIENTES (Tabla)
            // =========================================================
            const { data: propsData, error: propsError } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            if (propsData) {
                properties = propsData.map(prop => ({
                    ...prop,
                    // También formateamos la fecha de las propiedades por si acaso
                    created_at: formatDateChile(prop.created_at)
                }));
            }

            // =========================================================
            // 4. ESTADÍSTICAS (KPIs)
            // =========================================================
            const { count, error: countError } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true }); 

            if (!countError) totalProperties = count;

        } catch (error) {
            console.error('❌ Error Crítico Dashboard:', error);
        }

        // 5. Renderizar Vista
        res.render('dashboard', {
            title: 'Panel ERP | Cygnus',
            page: 'dashboard',
            user: req.session.user,
            
            // Datos procesados
            activityLogs,   
            properties,     
            totalProperties,
            ufValue // Enviamos la UF
        });
    }
};

module.exports = dashboardController;