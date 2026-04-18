const supabase = require('../config/supabaseClient');

/**
 * Middleware de Modo Mantenimiento Pro
 * Verifica si el sitio está en mantenimiento y redirige a una vista elegante
 * Excepto para rutas /admin
 */
const maintenanceMode = async (req, res, next) => {
    // Permitir siempre acceso al admin
    if (req.path.startsWith('/admin') || req.path.startsWith('/api')) {
        return next();
    }

    try {
        // Verificar estado de mantenimiento en la BD
        const { data: config } = await supabase
            .from('site_config')
            .select('maintenance_active, maintenance_message')
            .limit(1)
            .single();

        if (config && config.maintenance_active === true) {
            // Renderizar vista de mantenimiento elegante
            return res.status(503).render('maintenance', {
                message: config.maintenance_message || '<h1>Sitio en Mantenimiento</h1><p>Volvemos pronto.</p>',
                title: 'Mantenimiento | Cygnus Group'
            });
        }

        next();
    } catch (error) {
        console.error('Error verificando modo mantenimiento:', error);
        // En caso de error, permitir acceso (fail-safe)
        next();
    }
};

module.exports = maintenanceMode;
