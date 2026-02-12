// Archivo: controllers/dashboardController.js
const supabase = require('../config/supabaseClient');

// --- HELPER 1: FECHA CHILE FORZADA (DD/MM/AAAA) ---
// Usamos 'en-GB' porque siempre es Día/Mes. 'es-CL' a veces falla en Linux.
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
            hour12: false
        });

        // Retorna "12/02/2026, 16:30" (Día/Mes confirmado)
        return formatter.format(date).replace(',', '');
        
    } catch (e) {
        console.error("Error fecha:", e);
        return utcDateString.substring(0, 16).replace('T', ' ');
    }
};

// --- HELPER 2: MONEDA SEGURA (Anti-NAAN) ---
const formatMoney = (amount) => {
    // Convertimos a número por si viene como string
    const num = Number(amount);
    
    // Si no es número o es 0, devolvemos un placeholder o $0
    if (isNaN(num)) return '$ ---';

    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(num);
};

const dashboardController = {
    getDashboard: async (req, res) => {
        let properties = [];
        let activityLogs = []; 
        let totalProperties = 0; 

        try {
            // 1. LEER INDICADORES DESDE TU APP.JS
            // Tu app.js guarda esto en app.locals.indicators
            // Estructura esperada: { uf: 39700, usd: 975, ... }
            const current = req.app.locals.indicators || { uf: 0, usd: 0, utm: 0, ipc: 0 };

            // 2. OBTENER LOGS
            const { data: logsData } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (logsData) {
                // Aplicamos la corrección de fecha a cada log
                activityLogs = logsData.map(log => ({
                    ...log,
                    created_at: manualDateChile(log.created_at)
                }));
            }

            // 3. OBTENER PROPIEDADES (Para la tabla resumen)
            const { data: propsData } = await supabase
                .from('properties')
                .select(`*, agent:users ( name )`)
                .order('created_at', { ascending: false })
                .limit(5);

            if (propsData) {
                // Aplicamos la corrección de fecha a las propiedades
                properties = propsData.map(prop => ({
                    ...prop,
                    created_at: manualDateChile(prop.created_at)
                }));
            }

            // 4. TOTAL PROPIEDADES (KPI)
            const { count } = await supabase
                .from('properties')
                .select('*', { count: 'exact', head: true }); 
            
            totalProperties = count || 0;

            // 5. RENDERIZAR
            res.render('dashboard', {
                title: 'Panel ERP | Cygnus',
                page: 'dashboard',
                user: req.session.user,
                
                // Datos procesados
                activityLogs,   
                properties,     
                totalProperties,
                
                // INDICADORES ECONÓMICOS (Formateados aquí mismo)
                // Usamos las claves exactas que tienes en app.js: uf, usd, utm, ipc
                ufValue: formatMoney(current.uf),
                dolarValue: formatMoney(current.usd), // Ojo: en tu app.js es .usd
                utmValue: formatMoney(current.utm),
                ipcValue: (current.ipc || 0) + '%'
            });

        } catch (error) {
            console.error('❌ Error Dashboard:', error);
            // Render de seguridad
            res.render('dashboard', {
                title: 'Panel ERP',
                page: 'dashboard',
                user: req.session.user,
                activityLogs: [],
                properties: [],
                totalProperties: 0,
                ufValue: '$ ---', dolarValue: '$ ---', utmValue: '$ ---', ipcValue: '0%'
            });
        }
    }
};

module.exports = dashboardController;