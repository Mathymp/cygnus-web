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
const domainName = 'cygnusgroup.cl';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

if (!apiKey) {
    console.error("❌ ERROR: No hay API Key.");
    process.exit(1);
}

async function verify() {
    console.log(`\n🔍 Consultando estado de: ${domainName}...`);

    try {
        // En lugar de intentar crear, PRIMERO LISTAMOS los dominios
        // Esto evita el error 403 de "ya existe"
        const listResp = await fetch('https://api.resend.com/domains', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!listResp.ok) {
            console.error("❌ Error listando dominios:", await listResp.json());
            return;
        }

        const listData = await listResp.json();
        const found = listData.data ? listData.data.find(d => d.name === domainName) : null;

        if (!found) {
            console.log("ℹ️  El dominio no existe en esta cuenta. Intentando crear...");
            // Si no existe, lo creamos
            const createResp = await fetch('https://api.resend.com/domains', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: domainName })
            });
            const createData = await createResp.json();
            
            if (createResp.ok) {
                console.log("✅ Dominio creado. Obteniendo registros...");
                await sleep(1000);
                return showRecords(createData.id);
            } else {
                console.error("❌ Error al crear:", createData);
                return;
            }
        }

        // Si ya existe, obtenemos sus detalles
        console.log(`✅ Dominio encontrado (ID: ${found.id}). Obteniendo registros...`);
        await sleep(1000);
        return showRecords(found.id);

    } catch (error) {
        console.error("❌ Error de script:", error);
    }
}

async function showRecords(domainId) {
    try {
        // Si el ID es undefined, no podemos seguir
        if (!domainId) {
             console.error("❌ Error interno: ID de dominio no válido.");
             return;
        }

        const resp = await fetch(`https://api.resend.com/domains/${domainId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        const data = await resp.json();

        // INTENTAR VERIFICAR (Forzar chequeo)
        if (data.status !== 'verified') {
            console.log("🔄 Solicitando verificación a Resend...");
            await fetch(`https://api.resend.com/domains/${domainId}/verify`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            await sleep(1000);
        }

        console.log("\n=======================================================");
        console.log(`🌍 DOMINIO: ${data.name}`);
        console.log(`Tb  ESTADO: ${data.status.toUpperCase()}`);
        console.log("=======================================================\n");

        if (data.status === 'verified') {
            console.log("🎉 ¡FELICIDADES! TODO ESTÁ CORRECTO.");
            console.log("👉 Ya puedes usar el sistema de correos.");
        } else {
            console.log("⚠️  ESTADO PENDIENTE. Revisa estos registros en tu cPanel:\n");
            
            // Filtrar solo DKIM y SPF (los importantes)
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
            } else {
                // Si Resend no devuelve SPF (raro), mostramos el genérico
                console.log(`[SPF]`);
                console.log(`Nombre: cygnusgroup.cl`);
                console.log(`Valor:  v=spf1 include:resend.com ~all`);
            }
            
            console.log("\n💡 Si ya están puestos, es cuestión de tiempo (1-24h).");
        }

    } catch (e) {
        console.error("❌ Error mostrando registros:", e);
    }
}

verify();