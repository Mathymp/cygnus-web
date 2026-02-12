// Archivo: helpers/logger.js
const supabase = require('../config/supabaseClient');

const logActivity = async (userId, userName, action, entity, details) => {
    try {
        // Guardamos SIEMPRE en UTC (ISO String)
        // El dashboardController se encarga de pasarlo a Hora Chile al leerlo.
        await supabase.from('activity_logs').insert([{
            user_id: userId,
            user_name: userName,
            action_type: action,
            entity: entity,
            details: details,
            created_at: new Date().toISOString() 
        }]);
    } catch (error) {
        console.error("Error guardando log:", error.message);
    }
};

module.exports = logActivity;