// scripts/nukeAndres.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error("❌ ERROR: Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// EL CORREO EXACTO QUE DA PROBLEMAS
const targetEmail = 'andres@cygnusgroup.cl';

const nukeUser = async () => {
    console.log(`☢️  INICIANDO OPERACIÓN NUKE PARA: ${targetEmail}`);

    try {
        // 1. BUSCAR AL USUARIO (En BD pública)
        // Buscamos cualquier rastro, ignorando mayúsculas/minúsculas
        const { data: usersFound } = await supabase
            .from('users')
            .select('*')
            .ilike('email', targetEmail);

        if (usersFound && usersFound.length > 0) {
            for (const user of usersFound) {
                console.log(`   🔎 Encontrado en Base de Datos (ID: ${user.id}). Procesando...`);

                // 2. SALVAR PROPIEDADES (Pasarlas al Admin)
                // Buscamos al admin para darle las casas
                const { data: adminUser } = await supabase
                    .from('users')
                    .select('id')
                    .eq('role', 'admin')
                    .limit(1)
                    .single();

                if (adminUser) {
                    const { error: moveError } = await supabase
                        .from('properties')
                        .update({ agent_id: adminUser.id })
                        .eq('agent_id', user.id);
                    
                    if (!moveError) {
                        console.log(`   📦 Propiedades salvadas (Asignadas al Admin).`);
                    } else {
                        console.error(`   ⚠️ Error moviendo propiedades: ${moveError.message}`);
                    }
                }

                // 3. BORRAR DE BASE DE DATOS PÚBLICA
                const { error: delDb } = await supabase.from('users').delete().eq('id', user.id);
                if (!delDb) console.log(`   🗑️  Eliminado de tabla 'users'.`);
            }
        } else {
            console.log(`   ℹ️  No aparece en la tabla 'users' (Base de datos limpia).`);
        }

        // 4. BORRAR DE AUTH (Sistema de Seguridad)
        // Aquí es donde suelen quedar "fantasmas"
        const { data: authUsers } = await supabase.auth.admin.listUsers();
        const targetAuth = authUsers.users.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());

        if (targetAuth) {
            console.log(`   👻 Fantasma encontrado en Auth (ID: ${targetAuth.id}). Eliminando...`);
            const { error: delAuth } = await supabase.auth.admin.deleteUser(targetAuth.id);
            if (!delAuth) {
                console.log(`   ☠️  Eliminado de Auth definitivamente.`);
            } else {
                console.error(`   ❌ Error borrando de Auth: ${delAuth.message}`);
            }
        } else {
            console.log(`   ℹ️  No aparece en sistema Auth (Limpio).`);
        }

        console.log("\n✅ OPERACIÓN COMPLETADA. ANDRÉS HA SIDO BORRADO TOTALMENTE.");
        console.log("👉 Ahora puedes ir al Panel Admin y crearlo de nuevo sin conflictos.");

    } catch (e) {
        console.error("❌ Error inesperado:", e);
    }
};

nukeUser();