// Archivo: controllers/dashboardController.js
const supabase = require('../config/supabaseClient');

// --- HELPER: Formateador de Fecha Chile (DD/MM/AAAA HH:mm) ---
const formatDateChile = (utcDateString) => {
    if (!utcDateString) return '---';
    
    const date = new Date(utcDateString);
    
    // Forzamos la zona horaria de Santiago y el formato 24h
    const options = { 
        timeZone: 'America/Santiago', 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    };
    
    try {
        // Devuelve "12/02/2026, 18:30" -> Quitamos la coma
        return new Intl.DateTimeFormat('es-CL', options).format(date).replace(',', '');
    } catch (e) {
        return utcDateString; 
    }
};

const dashboardController = {
    getDashboard: async (req, res) => {
        let properties = [];
        let activityLogs = []; 
        let totalProperties = 0; 
        
        try {
            // 1. OBTENER INDICADORES (Desde la memoria de app.js)
            // Ya no hacemos fetch aquí. Usamos lo que el CRON de app.js actualizó.
            const indicators = req.app.locals.indicators || { uf: 0, usd: 0, ipc: 0, utm: 0 };

            // 2. OBTENER LOGS (Últimos 10)
            const { data: logsData, error: logsError } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (logsData) {
                // Convertimos la fecha UTC a Hora Chile para la vista
                activityLogs = logsData.map(log => ({
                    ...log,
                    created_at: formatDateChile(log.created_at)
                }));
            }

            // 3. OBTENER PROPIEDADES RECIENTES (Tabla)
            const { data: propsData, error: propsError } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            if (propsData) {
                properties = propsData.map(prop => ({
                    ...prop,
                    created_at: formatDateChile(prop.created_at)
                }));
            }

            // 4. KPI: TOTAL PROPIEDADES
            const { count, error: countError } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true }); 

            if (!countError) totalProperties = count;

            // 5. RENDERIZAR
            res.render('dashboard', {
                title: 'Panel ERP | Cygnus',
                page: 'dashboard',
                user: req.session.user,
                
                // Datos de Tablas
                activityLogs,   
                properties,     
                totalProperties,
                
                // Indicadores Económicos (Directo de app.js)
                // Usamos Intl.NumberFormat para asegurar que se vean como moneda ($ 38.000)
                ufValue: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(indicators.uf),
                usdValue: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(indicators.usd),
                utmValue: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(indicators.utm),
                ipcValue: indicators.ipc + '%'
            });

        } catch (error) {
            console.error('❌ Error Crítico Dashboard:', error);
            // Si falla, redirigimos al login por seguridad
            res.redirect('/login'); 
        }
    }
};

module.exports = dashboardController;