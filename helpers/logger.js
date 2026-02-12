// Archivo: helpers/logger.js
const supabase = require('../config/supabaseClient');

const logActivity = async (userId, userName, action, entity, details) => {
    try {
        await supabase.from('activity_logs').insert([{
            user_id: userId,
            user_name: userName,
            action_type: action,
            entity: entity,
            details: details,
            created_at: new Date().toISOString() // Guardamos en UTC estándar
        }]);
    } catch (error) {
        console.error("Error guardando log:", error.message);
    }
};

module.exports = logActivity;