const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const axios = require('axios');
const multer = require('multer'); // Necesario para detectar errores de upload
const moment = require('moment-timezone'); // REFUERZO: Control total de tiempo
require('dotenv').config();

// --- CONFIGURACIÓN DE ZONA HORARIA GLOBAL (RENDER/VERCEL FIX) ---
const CHILE_TZ = 'America/Santiago';
process.env.TZ = CHILE_TZ;

// --- NUEVOS REQUERIMIENTOS PARA SESIONES EN VERCEL ---
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const app = express();

// --- IMPORTANTE PARA VERCEL/RENDER (PROXY) ---
app.set('trust proxy', 1);

// --- Configuraciones ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Middlewares de Parseo (AUMENTADOS A 100MB) ---
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));
app.use(cookieParser());

// --- CONFIGURACIÓN BASE DE DATOS PARA SESIONES ---
const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- CONFIGURACIÓN DE SESIÓN ---
app.use(session({
    store: new pgSession({
        pool: pgPool,                
        tableName: 'session',        
        createTableIfMissing: true   
    }),
    secret: process.env.SESSION_SECRET || 'cygnus_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', 
        maxAge: 1000 * 60 * 60 * 24 // 1 día
    } 
}));

app.use(flash());

// =========================================================
// --- SISTEMA DE INDICADORES ECONÓMICOS (REFORZADO) ---
// =========================================================

const BACKUP_INDICATORS = {
    uf: 38200.50,      
    usd: 960.00,       
    utm: 69500.00,     
    ipc: 0.8,       
    source: 'Respaldo Manual (Offline)',
    date: moment().tz(CHILE_TZ).format()
};

// Inicialización para evitar el $NaN en el arranque
app.locals.indicators = { ...BACKUP_INDICATORS };

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const updateEconomicIndicators = async () => {
    const nowInChile = moment().tz(CHILE_TZ);
    console.log(`🔄 [ECONOMÍA] Actualizando: ${nowInChile.format('DD-MM-YYYY HH:mm:ss')}`);

    // INSTANCIA 1: mindicador.cl (Con reintentos y validación de tipos)
    for (let i = 1; i <= 4; i++) {
        try {
            const response = await axios.get('https://mindicador.cl/api', { timeout: 8000 });
            const data = response.data;
            if (data && data.uf && data.uf.valor) {
                app.locals.indicators = {
                    uf: Number(data.uf.valor),
                    usd: data.dolar ? Number(data.dolar.valor) : app.locals.indicators.usd,
                    utm: data.utm ? Number(data.utm.valor) : app.locals.indicators.utm,
                    ipc: data.ipc ? Number(data.ipc.valor) : app.locals.indicators.ipc,
                    source: 'API Principal (mindicador.cl)',
                    date: nowInChile.format()
                };
                console.log('✅ [ECONOMÍA] Éxito con API Principal.');
                logIndicators();
                return; 
            }
        } catch (error) {
            console.warn(`   ⚠️ Intento ${i} fallido mindicador.`);
            if (i < 4) await wait(3000); 
        }
    }

    // INSTANCIA 2: gael.cl (Más confiable que findic para producción)
    try {
        const response2 = await axios.get('https://api.gael.cl/general/public/indicadores', { timeout: 8000 });
        if (response2.data && Array.isArray(response2.data)) {
            const getVal = (code) => response2.data.find(idx => idx.Codigo === code)?.Valor;
            
            app.locals.indicators = {
                uf: Number(getVal('UF')) || app.locals.indicators.uf,
                usd: Number(getVal('Dolar')) || app.locals.indicators.usd,
                utm: Number(getVal('UTM')) || app.locals.indicators.utm,
                ipc: app.locals.indicators.ipc,
                source: 'API Secundaria (Gael)',
                date: nowInChile.format()
            };
            console.log('✅ [ECONOMÍA] Éxito con API Secundaria.');
            logIndicators();
            return;
        }
    } catch (error) {
        console.error(`   ❌ Fallo total indicadores.`);
    }
    app.locals.indicators.source = 'Modo Respaldo Activo';
};

function logIndicators() {
    console.log(`   📊 UF: $${app.locals.indicators.uf} | USD: $${app.locals.indicators.usd}`);
}

// Carga inicial
updateEconomicIndicators();

// Cron configurado para las 02:00 AM hora de CHILE
cron.schedule('0 2 * * *', () => {
    updateEconomicIndicators();
}, { 
    scheduled: true,
    timezone: CHILE_TZ 
});

app.get('/api/cron-update', async (req, res) => {
    try {
        await updateEconomicIndicators();
        res.json({ success: true, data: app.locals.indicators });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// --- Middleware Global (Seguridad de Datos para Vistas) ---
// =========================================================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.path = req.path;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    
    // Inyección blindada de indicadores
    const current = app.locals.indicators || BACKUP_INDICATORS;
    res.locals.indicators = current;
    res.locals.ufValue = Number(current.uf) || BACKUP_INDICATORS.uf;
    res.locals.dolarValue = Number(current.usd) || BACKUP_INDICATORS.usd;
    res.locals.utmValue = Number(current.utm) || BACKUP_INDICATORS.utm;
    res.locals.ipcValue = (current.ipc !== undefined) ? Number(current.ipc) : BACKUP_INDICATORS.ipc; 
    
    // Pasar moment y zona horaria a todas las vistas EJS
    res.locals.moment = moment;
    res.locals.CHILE_TZ = CHILE_TZ;
    
    next();
});

// --- Rutas ---
const webRoutes = require('./routes/webRoutes');
app.use('/', webRoutes);

// =========================================================
// --- MANEJADOR DE ERRORES (DETECCIÓN DE 413/MULTER) ---
// =========================================================
app.use((err, req, res, next) => {
    console.error("🔥 Error detectado:", err);

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'El archivo es demasiado grande (Máx 100MB).' });
        }
        if (err.code === 'LIMIT_FIELD_VALUE' || err.code === 'LIMIT_FIELD_SIZE') {
            return res.status(413).json({ success: false, message: 'La descripción o los datos de texto son demasiado largos.' });
        }
        return res.status(500).json({ success: false, message: `Error de subida: ${err.message}` });
    }

    if (err.type === 'entity.too.large' || err.statusCode === 413) {
        return res.status(413).json({ success: false, message: 'La solicitud es demasiado pesada para el servidor.' });
    }

    if (req.url.startsWith('/api') || req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        return res.status(500).json({ 
            success: false, 
            message: err.message || 'Error interno del servidor' 
        });
    }

    res.status(500).render('index', { 
        title: 'Error del Servidor',
        activePage: 'home',
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

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Servidor Cygnus Profesional listo en Puerto ${PORT} | Zona: ${CHILE_TZ}`);
    });
}

module.exports = app;