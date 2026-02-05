const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const app = express();

// --- Configuraciones ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Middlewares ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));
app.use(cookieParser());

// Configuración de Sesión
app.use(session({
    secret: process.env.SESSION_SECRET || 'cygnus_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // true si usas HTTPS en producción
        maxAge: 1000 * 60 * 60 * 24 // 1 día
    } 
}));

// Sistema de Alertas Flash
app.use(flash());

// =========================================================
// --- SISTEMA DE INDICADORES ECONÓMICOS (MULTINIVEL) ---
// =========================================================

// NIVEL 3: VALORES DE RESPALDO (POR SI TODO FALLA)
const BACKUP_INDICATORS = {
    uf: 39700,      
    usd: 975,       
    utm: 69500,     
    ipc: 0.8,       
    source: 'Respaldo Manual (Offline)',
    date: new Date()
};

// Inicializamos la memoria con el respaldo de inmediato
app.locals.indicators = { ...BACKUP_INDICATORS };

/**
 * Función auxiliar para esperar (Delay)
 */
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * LÓGICA DE ACTUALIZACIÓN INTELIGENTE
 */
const updateEconomicIndicators = async () => {
    console.log('🔄 [ECONOMÍA] Iniciando ciclo de actualización de indicadores...');

    // --- INSTANCIA 1: API PRINCIPAL (mindicador.cl) ---
    for (let i = 1; i <= 4; i++) {
        try {
            console.log(`   👉 Intento ${i}/4 con API Principal (mindicador.cl)...`);
            const response = await axios.get('https://mindicador.cl/api', { timeout: 5000 });
            const data = response.data;

            if (data && data.uf) {
                app.locals.indicators = {
                    uf: data.uf.valor,
                    usd: data.dolar ? data.dolar.valor : app.locals.indicators.usd,
                    utm: data.utm ? data.utm.valor : app.locals.indicators.utm,
                    ipc: data.ipc ? data.ipc.valor : app.locals.indicators.ipc,
                    source: 'API Principal (mindicador.cl)',
                    date: new Date()
                };
                console.log('✅ [ECONOMÍA] Éxito con API Principal.');
                logIndicators();
                return; // ¡Éxito! Salimos de la función.
            }
        } catch (error) {
            console.warn(`   ⚠️ Falló intento ${i}: ${error.message}`);
            if (i < 4) await wait(2000); // Esperar 2 seg antes de reintentar
        }
    }

    console.warn('⚠️ [ECONOMÍA] API Principal falló 4 veces. Pasando a INSTANCIA 2...');

    // --- INSTANCIA 2: API SECUNDARIA (findic.cl) ---
    try {
        console.log('   👉 Intentando con API Secundaria (findic.cl)...');
        const response2 = await axios.get('https://findic.cl/api/', { timeout: 5000 });
        const data2 = response2.data;

        if (data2 && data2.uf) {
            app.locals.indicators = {
                uf: parseFloat(data2.uf.valor),
                usd: parseFloat(data2.dolar.valor),
                utm: parseFloat(data2.utm.valor),
                ipc: parseFloat(data2.ipc.valor || 0),
                source: 'API Secundaria (findic.cl)',
                date: new Date()
            };
            console.log('✅ [ECONOMÍA] Éxito con API Secundaria.');
            logIndicators();
            return;
        }
    } catch (error) {
        console.error(`   ❌ API Secundaria también falló: ${error.message}`);
    }

    // --- INSTANCIA 3: RESPALDO FINAL ---
    console.error('❌ [ECONOMÍA] FALLA TOTAL DE RED. Manteniendo valores de respaldo/memoria.');
    app.locals.indicators.source = 'Modo Respaldo (Sin conexión)';
};

// Función para imprimir valores en consola
function logIndicators() {
    console.log(`   📊 UF: $${app.locals.indicators.uf} | USD: $${app.locals.indicators.usd} | UTM: $${app.locals.indicators.utm} | IPC: ${app.locals.indicators.ipc}%`);
}

// 1. Ejecutar al inicio (Arrancar servidor)
// IMPORTANTE PARA VERCEL: Esto asegura que al "despertar" la función serverless, intente cargar datos frescos.
updateEconomicIndicators();

// 2. Programar actualización automática (CRON LOCAL)
// Esto funciona si corres en local o un VPS, pero Vercel lo ignora.
cron.schedule('0 2 * * *', () => {
    console.log('⏰ [CRON LOCAL] Ejecutando actualización programada (02:00 AM)...');
    updateEconomicIndicators();
}, {
    timezone: "America/Santiago"
});

// 3. RUTA ESPECIAL PARA VERCEL CRON
// Esta ruta será llamada por el Cron Job de Vercel (definido en vercel.json)
app.get('/api/cron-update', async (req, res) => {
    console.log('⏰ [VERCEL CRON] Ejecutando actualización solicitada...');
    try {
        await updateEconomicIndicators();
        res.json({ 
            success: true, 
            message: 'Indicadores actualizados correctamente', 
            data: app.locals.indicators 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// =========================================================
// --- Middleware Global (Variables para TODAS las vistas) ---
// =========================================================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.path = req.path;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    
    // --- INYECCIÓN SEGURA DE INDICADORES ---
    const current = app.locals.indicators || BACKUP_INDICATORS;

    // Pasamos el objeto completo
    res.locals.indicators = current;
    
    // ALIAS (Para que tu Dashboard y Vistas no fallen)
    res.locals.ufValue = current.uf || BACKUP_INDICATORS.uf;
    res.locals.dolarValue = current.usd || BACKUP_INDICATORS.usd;
    res.locals.utmValue = current.utm || BACKUP_INDICATORS.utm;
    res.locals.ipcValue = (current.ipc !== undefined) ? current.ipc : BACKUP_INDICATORS.ipc; 
    
    next();
});

// --- Rutas ---
const webRoutes = require('./routes/webRoutes');
app.use('/', webRoutes);

// --- Manejador de Errores Global ---
app.use((err, req, res, next) => {
    console.error("🔥 Error detectado:", err.stack);

    if (req.url.startsWith('/api') || req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        return res.status(500).json({ 
            success: false, 
            message: err.message || 'Error interno del servidor' 
        });
    }

    // Renderizar página de error amigable
    res.status(500).render('index', { 
        title: 'Error del Servidor',
        activePage: 'home',
        ufValue: 0, dolarValue: 0, utmValue: 0, ipcValue: 0,
        error: 'Ocurrió un problema inesperado.'
    });
});

// --- 404 ---
app.use((req, res) => {
    res.status(404).render('index', { 
        title: 'Página no encontrada',
        activePage: 'home' 
    });
});

// --- Iniciar Servidor (COMPATIBLE VERCEL + LOCAL) ---
const PORT = process.env.PORT || 3000;

// Si el archivo se ejecuta directamente (Local), inicia el servidor.
// Si es importado por Vercel, exporta la app.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Servidor Cygnus listo en http://localhost:${PORT}`);
    });
}

// Exportamos 'app' para que Vercel pueda manejarlo como Serverless Function
module.exports = app;