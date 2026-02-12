const supabase = require('../config/supabaseClient');

/**
 * LogActivity Blindado
 * Registra acciones en la base de datos asegurando formato ISO.
 */
const logActivity = async (userId, userName, action, entity, details) => {
    try {
        // Guardamos SIEMPRE en formato ISO (UTC) estándar.
        // Esto evita líos de zonas horarias en la base de datos.
        const { error } = await supabase.from('activity_logs').insert([{
            user_id: userId,
            user_name: userName,
            action_type: action,
            entity: entity,
            details: details,
            created_at: new Date().toISOString() 
        }]);

        if (error) throw error;
    } catch (error) {
        console.error("❌ Error guardando log en Supabase:", error.message);
    }
};

module.exports = logActivity;