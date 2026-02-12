const supabase = require('../config/supabaseClient');

// --- HELPER: FECHA CHILE (Sin librerías, puro JS nativo) ---
const manualDateChile = (utcDateString) => {
    if (!utcDateString) return '-';
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Santiago',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            hour12: false
        }).format(new Date(utcDateString)).replace(',', '');
    } catch (e) {
        return utcDateString;
    }
};

// --- HELPER: MONEDA ($ CLP) ---
// Solo lo usaremos para elementos visuales que no requieren cálculo (como precios de lista)
const formatMoney = (amount) => {
    const num = Number(amount);
    if (isNaN(num) || num === 0) return '$ ---';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(num);
};

const dashboardController = {
    getDashboard: async (req, res) => {
        try {
            // 1. OBTENER INDICADORES DE MEMORIA (APP.JS)
            // app.js ya garantiza que estos son números, pero hacemos un fallback seguro.
            const appIndicators = req.app.locals.indicators || {};
            
            // Aseguramos que sean NÚMEROS para que la vista pueda calcular
            const indicators = {
                uf: Number(appIndicators.uf) || 0,
                usd: Number(appIndicators.usd) || 0,
                utm: Number(appIndicators.utm) || 0,
                ipc: Number(appIndicators.ipc) || 0,
                date: appIndicators.date
            };

            console.log("📊 [DASHBOARD] Cargando indicadores (Numericos):", indicators);

            // 2. OBTENER LOGS DE ACTIVIDAD
            const { data: logsData } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            // Procesar fechas de logs
            const activityLogs = (logsData || []).map(log => ({
                ...log,
                fecha_display: manualDateChile(log.created_at)
            }));

            // 3. OBTENER PROPIEDADES (Para resumen tabla)
            const { data: propsData } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            // Procesar fechas y precios de propiedades
            const properties = (propsData || []).map(prop => ({
                ...prop,
                fecha_display: manualDateChile(prop.created_at),
                precio_display: formatMoney(prop.price)
            }));

            // 4. KPI: TOTAL PROPIEDADES
            const { count } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true });

            // 5. RENDERIZAR VISTA
            res.render('dashboard', {
                title: 'Panel de Control',
                page: 'dashboard',
                user: req.session.user,

                // Datos de BD
                activityLogs,
                properties,
                totalProperties: count || 0,

                // --- CORRECCIÓN CRÍTICA AQUÍ ---
                // Pasamos los valores CRUDOS (Number) para que la vista pueda hacer Math
                // La vista se encarga de ponerles el "$" con .toLocaleString()
                ufValue: indicators.uf,
                dolarValue: indicators.usd,
                utmValue: indicators.utm,
                ipcValue: indicators.ipc, // Se pasa el número (0.8), la vista añade el '%'
                
                // Fecha de última actualización de indicadores
                lastUpdate: indicators.date ? manualDateChile(indicators.date) : 'Inicio'
            });

        } catch (error) {
            console.error('🔥 Error en Dashboard Controller:', error);
            // Render de emergencia (Failsafe)
            res.render('dashboard', {
                title: 'Panel ERP (Modo Seguro)',
                page: 'dashboard',
                user: req.session.user,
                activityLogs: [],
                properties: [],
                totalProperties: 0,
                // En caso de error, pasamos 0 numérico para evitar NaN en vista
                ufValue: 0, dolarValue: 0, utmValue: 0, ipcValue: 0,
                lastUpdate: 'Error'
            });
        }
    }
};

module.exports = dashboardController;