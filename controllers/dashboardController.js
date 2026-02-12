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
const formatMoney = (amount) => {
    const num = Number(amount);
    if (isNaN(num) || num === 0) return '$ ---';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(num);
};

const dashboardController = {
    getDashboard: async (req, res) => {
        try {
            // 1. OBTENER INDICADORES DE MEMORIA (APP.JS)
            // Si por milagro están vacíos, usamos ceros, pero app.js ya los inicializó.
            const indicators = req.app.locals.indicators || { uf: 0, usd: 0, utm: 0, ipc: 0 };
            console.log("📊 [DASHBOARD] Cargando indicadores:", indicators);

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

            // 5. RENDERIZAR VISTA (Ruta corregida: 'dashboard')
            res.render('dashboard', {
                title: 'Panel de Control',
                page: 'dashboard',
                user: req.session.user,

                // Datos de BD
                activityLogs,
                properties,
                totalProperties: count || 0,

                // INDICADORES (Formateados directo para las tarjetas)
                ufValue: formatMoney(indicators.uf),
                dolarValue: formatMoney(indicators.usd),
                utmValue: formatMoney(indicators.utm),
                ipcValue: (indicators.ipc || 0) + '%',
                
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
                ufValue: '$ ---', dolarValue: '$ ---', utmValue: '$ ---', ipcValue: '0%',
                lastUpdate: 'Error'
            });
        }
    }
};

module.exports = dashboardController;