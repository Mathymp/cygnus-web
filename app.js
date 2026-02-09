const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const axios = require('axios');
const multer = require('multer'); // Necesario para detectar errores de upload
require('dotenv').config();

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
// Esto es para JSON y URL-Encoded. Multer maneja el Multipart (archivos).
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
// --- SISTEMA DE INDICADORES ECONÓMICOS ---
// =========================================================

const BACKUP_INDICATORS = {
    uf: 39700,      
    usd: 975,       
    utm: 69500,     
    ipc: 0.8,       
    source: 'Respaldo Manual (Offline)',
    date: new Date()
};

app.locals.indicators = { ...BACKUP_INDICATORS };

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const updateEconomicIndicators = async () => {
    console.log('🔄 [ECONOMÍA] Iniciando ciclo de actualización...');

    // INSTANCIA 1: mindicador.cl
    for (let i = 1; i <= 4; i++) {
        try {
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
                return; 
            }
        } catch (error) {
            console.warn(`   ⚠️ Intento ${i} fallido.`);
            if (i < 4) await wait(2000); 
        }
    }

    // INSTANCIA 2: findic.cl
    try {
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
        console.error(`   ❌ Fallo total indicadores.`);
    }
    app.locals.indicators.source = 'Modo Respaldo';
};

function logIndicators() {
    console.log(`   📊 UF: $${app.locals.indicators.uf} | USD: $${app.locals.indicators.usd}`);
}

updateEconomicIndicators();

cron.schedule('0 2 * * *', () => {
    updateEconomicIndicators();
}, { timezone: "America/Santiago" });

app.get('/api/cron-update', async (req, res) => {
    try {
        await updateEconomicIndicators();
        res.json({ success: true, data: app.locals.indicators });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// --- Middleware Global ---
// =========================================================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.path = req.path;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    
    const current = app.locals.indicators || BACKUP_INDICATORS;
    res.locals.indicators = current;
    res.locals.ufValue = current.uf || BACKUP_INDICATORS.uf;
    res.locals.dolarValue = current.usd || BACKUP_INDICATORS.usd;
    res.locals.utmValue = current.utm || BACKUP_INDICATORS.utm;
    res.locals.ipcValue = (current.ipc !== undefined) ? current.ipc : BACKUP_INDICATORS.ipc; 
    
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

    // Detección específica de errores de Multer (Tamaño)
    if (err instanceof multer.MulterError) {
        console.error("📸 Error de Multer:", err.code);
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'El archivo es demasiado grande (Máx 100MB).' });
        }
        if (err.code === 'LIMIT_FIELD_VALUE' || err.code === 'LIMIT_FIELD_SIZE') {
            return res.status(413).json({ success: false, message: 'La descripción o los datos de texto son demasiado largos.' });
        }
        return res.status(500).json({ success: false, message: `Error de subida: ${err.message}` });
    }

    // Error 413 Genérico (Body Parser o Nginx)
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

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Servidor Cygnus listo en http://localhost:${PORT}`);
    });
}

module.exports = app;