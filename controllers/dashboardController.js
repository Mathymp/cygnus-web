const supabase = require('../config/supabaseClient');

// --- HELPER 1: FECHA CHILE SIN LIBRERÍAS (Nativo) ---
// Convierte UTC a Hora Chile sin necesitar instalar 'moment'
const manualDateChile = (utcDateString) => {
    if (!utcDateString) return '-';
    try {
        const date = new Date(utcDateString);
        // Usamos Intl nativo de Javascript para forzar la zona horaria
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Santiago',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        // Formatea a "DD/MM/YYYY HH:mm:ss"
        return formatter.format(date).replace(',', '');
    } catch (e) {
        console.error("❌ Error formateando fecha:", e);
        return utcDateString;
    }
};

// --- HELPER 2: MONEDA SEGURA (Anti-NaN) ---
const formatMoney = (amount) => {
    const num = Number(amount);
    // Si falla la conversión, devolvemos un guion en vez de NaN
    if (isNaN(num) || num === 0) return '$ ---';
    
    return new Intl.NumberFormat('es-CL', { 
        style: 'currency', 
        currency: 'CLP',
        minimumFractionDigits: 0 
    }).format(num);
};

const dashboardController = {
    getDashboard: async (req, res) => {
        // Variables iniciales vacías por seguridad
        let properties = [];
        let activityLogs = []; 
        let totalProperties = 0; 

        try {
            // 1. OBTENER INDICADORES
            // Rescata lo que app.js guardó en memoria. Si falla, usa ceros.
            const current = req.app.locals.indicators || { uf: 0, usd: 0, utm: 0, ipc: 0 };

            // 2. OBTENER LOGS DE ACTIVIDAD
            const { data: logsData, error: logsError } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (logsData) {
                // Procesamos cada log para arreglar la fecha
                activityLogs = logsData.map(log => ({
                    ...log,
                    fecha_display: manualDateChile(log.created_at)
                }));
            }

            // 3. OBTENER ÚLTIMAS PROPIEDADES (Resumen)
            const { data: propsData, error: propsError } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            if (propsData) {
                // Procesamos propiedades para arreglar fecha y precio
                properties = propsData.map(prop => ({
                    ...prop,
                    fecha_display: manualDateChile(prop.created_at),
                    precio_display: formatMoney(prop.price)
                }));
            }

            // 4. KPI: CONTAR TOTAL PROPIEDADES
            const { count, error: countError } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true }); 
            
            totalProperties = count || 0;

            // 5. RENDERIZAR VISTA
            // CORRECCIÓN IMPORTANTE: Cambiado de 'admin/dashboard' a 'dashboard'
            res.render('dashboard', {
                title: 'Panel de Control | CygnusGroup',
                page: 'dashboard', // Usado para activar el menú lateral
                user: req.session.user,
                
                // Datos procesados
                activityLogs,   
                properties,     
                totalProperties,
                
                // Indicadores formateados (Texto limpio para la vista)
                ufValue: formatMoney(current.uf),
                dolarValue: formatMoney(current.usd), 
                utmValue: formatMoney(current.utm),
                ipcValue: (current.ipc || 0) + '%',
                
                lastUpdate: current.date ? manualDateChile(current.date) : 'No disponible'
            });

        } catch (error) {
            console.error('🔥 Error Crítico en Dashboard:', error);
            
            // Render de emergencia (Failsafe)
            // También corregido a la ruta 'dashboard'
            res.render('dashboard', {
                title: 'Panel ERP (Modo Seguro)',
                page: 'dashboard',
                user: req.session.user,
                activityLogs: [],
                properties: [],
                totalProperties: 0,
                ufValue: '$ ---', 
                dolarValue: '$ ---', 
                utmValue: '$ ---', 
                ipcValue: '0%',
                lastUpdate: 'Error de conexión'
            });
        }
    }
};

module.exports = dashboardController;