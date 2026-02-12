const supabase = require('../config/supabaseClient');

// --- HELPER 1: FECHA CHILE FORZADA (DD/MM/AAAA HH:mm) ---
// Usamos 'en-GB' para asegurar formato Día/Mes y forzamos la zona horaria de Chile.
const manualDateChile = (utcDateString) => {
    if (!utcDateString) return '-';
    try {
        const date = new Date(utcDateString);
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Santiago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        // Formato resultante: "12/02/2026 16:30:00"
        return formatter.format(date).replace(',', '');
    } catch (e) {
        console.error("❌ Error formateando fecha:", e);
        return utcDateString; 
    }
};

// --- HELPER 2: MONEDA CHILENA BLINDADA (Anti-NaN) ---
const formatMoney = (amount) => {
    const num = Number(amount);
    // Si no es un número válido, devolvemos un string seguro para no romper la UI
    if (isNaN(num) || num === 0) return '$ ---';

    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0
    }).format(num);
};

const dashboardController = {
    getDashboard: async (req, res) => {
        // Variables iniciales de seguridad
        let properties = [];
        let activityLogs = []; 
        let totalProperties = 0; 

        try {
            // 1. RESCATE DE INDICADORES (Desde app.locals configurado en app.js)
            // Usamos las claves exactas: uf, usd, utm, ipc
            const current = req.app.locals.indicators || { uf: 0, usd: 0, utm: 0, ipc: 0 };

            // 2. OBTENER LOGS DE ACTIVIDAD
            // Nota: He usado 'activity_logs' como en tu código, asegúrate que la tabla sea esa.
            const { data: logsData, error: logsError } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (logsData) {
                activityLogs = logsData.map(log => ({
                    ...log,
                    // Blindamos la fecha para que se vea bien en Chile
                    fecha_display: manualDateChile(log.created_at)
                }));
            }

            // 3. OBTENER ÚLTIMAS PROPIEDADES (Resumen de tabla)
            const { data: propsData, error: propsError } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            if (propsData) {
                properties = propsData.map(prop => ({
                    ...prop,
                    // Blindamos la fecha de creación de la propiedad
                    fecha_display: manualDateChile(prop.created_at),
                    // Blindamos el precio si viene en CLP
                    precio_display: formatMoney(prop.price) 
                }));
            }

            // 4. KPI: TOTAL PROPIEDADES
            const { count, error: countError } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true }); 
            
            totalProperties = count || 0;

            // 5. RENDERIZADO FINAL CON DATOS PRE-PROCESADOS
            res.render('admin/dashboard', {
                title: 'Panel de Control Profesional | CygnusGroup',
                page: 'dashboard',
                user: req.session.user,
                
                // Colecciones procesadas
                activityLogs,   
                properties,     
                totalProperties,
                
                // INDICADORES ECONÓMICOS BLINDADOS (Listos para mostrar)
                // Se procesan aquí para que la vista reciba solo texto limpio
                ufValue: formatMoney(current.uf),
                dolarValue: formatMoney(current.usd), 
                utmValue: formatMoney(current.utm),
                ipcValue: (current.ipc || 0) + '%',
                
                // Metadatos de actualización
                lastUpdate: current.date ? manualDateChile(current.date) : 'No disponible'
            });

        } catch (error) {
            console.error('🔥 Error Crítico en Dashboard Controller:', error);
            
            // Render de emergencia para que el sitio no se caiga (Failsafe)
            res.render('admin/dashboard', {
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