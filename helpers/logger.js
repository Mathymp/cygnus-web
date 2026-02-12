// Archivo: helpers/logger.js
const supabase = require('../config/supabaseClient');

const logActivity = async (userId, userName, action, entity, details) => {
    try {
        // Guardamos SIEMPRE en formato ISO (UTC) estándar.
        // Esto evita líos de zonas horarias en la base de datos.
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