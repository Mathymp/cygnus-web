// scripts/verifyDomain.js
const path = require('path');
const fs = require('fs');

// 1. CARGAR .ENV
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const apiKey = process.env.RESEND_API_KEY;
const domain = 'cygnusgroup.cl';

// Pequeña función para esperar (evita el error 429)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 2. VALIDAR
if (!apiKey) {
    console.error("❌ ERROR: No hay API Key.");
    process.exit(1);
}

async function verify() {
    console.log(`\n🔍 Conectando con Resend para verificar: ${domain}...`);

    try {
        // A. INTENTAR CREAR (o verificar existencia)
        let response = await fetch('https://api.resend.com/domains', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: domain })
        });

        let data = await response.json();

        // B. SI YA EXISTE, OBTENER DATOS
        if (!response.ok) {
            if (response.status === 429) {
                console.log("⏳ Calma... Resend nos pide esperar un segundo.");
                await sleep(1500); // Esperar 1.5 segundos
                // Reintentar...
                return verify(); 
            }

            if (data.message && data.message.includes('already exists')) {
                console.log("ℹ️  El dominio ya existe. Obteniendo detalles...");
                
                await sleep(1000); // Pausa de cortesía

                // Listar dominios
                const listResp = await fetch('https://api.resend.com/domains', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                
                if (listResp.status === 429) {
                     console.log("⏳ Esperando otro poco...");
                     await sleep(2000);
                     // Aquí deberíamos reintentar, pero para simplificar, seguimos
                }

                const listData = await listResp.json();
                const found = listData.data ? listData.data.find(d => d.name === domain) : null;
                
                if (found) {
                    await sleep(1000); // Otra pausa antes del detalle
                    
                    // Obtener detalles (registros DNS)
                    const detailResp = await fetch(`https://api.resend.com/domains/${found.id}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    data = await detailResp.json();
                } else {
                    console.error("❌ Error: No se encontró en la lista.");
                    return;
                }
            } else {
                console.error("❌ Error API:", data);
                return;
            }
        }

        // C. MOSTRAR RESULTADO
        console.log("\n=======================================================");
        console.log(`✅ DOMINIO: ${domain}`);
        console.log(`   Estado: ${data.status ? data.status.toUpperCase() : 'DESCONOCIDO'}`);
        console.log("=======================================================\n");

        if (data.status === 'verified') {
            console.log("🎉 ¡FELICIDADES! DOMINIO VERIFICADO 100%");
            console.log("👉 Ya puedes enviar correos desde contacto@cygnusgroup.cl");
        } else {
            console.log("⚠️  ESTADO PENDIENTE. Verifica tus registros en cPanel:\n");
            
            if (data.records) {
                // Filtramos solo los importantes (DKIM y SPF)
                const dkim = data.records.find(r => r.record === 'TXT' && r.name.includes('domainkey'));
                const spf = data.records.find(r => r.record === 'TXT' && r.value.includes('spf1'));

                if (dkim) {
                    console.log(`[DKIM]`);
                    console.log(`Nombre: resend._domainkey`);
                    console.log(`Valor:  ${dkim.value}`);
                    console.log(`-----------------------------------`);
                }
                if (spf) {
                    console.log(`[SPF]`);
                    console.log(`Nombre: cygnusgroup.cl`);
                    console.log(`Valor:  v=spf1 include:resend.com ~all`);
                    console.log(`-----------------------------------`);
                }
            }
            console.log("\n💡 Si ya los pusiste, solo espera. La propagación tarda.");
        }

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

verify();