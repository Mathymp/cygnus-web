// Ejecuta este archivo una sola vez con: node seed.js
const supabase = require('./config/supabaseClient');
const bcrypt = require('bcryptjs');

async function createAdmin() {
    const email = 'admin@cygnus.cl';
    const password = 'Admin123'; // Cambia esto si quieres
    const name = 'Administrador Cygnus';

    // 1. Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 2. Insertar en Supabase
    const { data, error } = await supabase
        .from('users')
        .insert([
            { email, password: hashedPassword, role: 'admin', name }
        ])
        .select();

    if (error) {
        console.error('❌ Error creando admin:', error.message);
    } else {
        console.log('✅ Usuario Admin creado con éxito!');
        console.log('📧 Email:', email);
        console.log('🔑 Pass:', password);
    }
}

createAdmin();