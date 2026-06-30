const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // <-- AGREGADO para consultas nativas directas y seguras

// --- IMPORTAR CONTROLADORES ---
const mainController = require('../controllers/mainController');
const authController = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const userController = require('../controllers/userController');
const propertiesController = require('../controllers/propertiesController');
const editPropertyController = require('../controllers/editPropertyController'); 
const inventoryController = require('../controllers/inventoryController');
const pdfController = require('../controllers/pdfController');
const supabase = require('../config/supabaseClient');
const panoramasController = require('../controllers/panoramasController');

// --- IMPORTAR CONTROLADORES LOTIFY ---
const projectController = require('../controllers/projectController');
const loteController = require('../controllers/loteController');
const crmController = require('../controllers/crmController');

// --- IMPORTAR CONTROLADORES INMOBILIARIA CAMPOS ---
const inmobiliariaController = require('../controllers/inmobiliariaController');
const documentosController = require('../controllers/documentosController');

// --- CONFIGURACIÓN DE UPLOAD ---
const upload = require('../config/cloudinaryConfig');
const multerLib2 = require('multer');
const uploadDocMemory = multerLib2({ storage: multerLib2.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const cloudinaryV2 = require('cloudinary').v2;
const multerLib = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const panoStorage = new CloudinaryStorage({
    cloudinary: cloudinaryV2,
    params: { folder: 'cygnus_360', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], resource_type: 'image' }
});
const uploadPano = multerLib({ storage: panoStorage, limits: { fileSize: 200 * 1024 * 1024 } });

// --- CONEXIÓN NATIVA BD (LOTIFY) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- MIDDLEWARE DE SEGURIDAD ---
const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// --- MIDDLEWARE: Inyecta flags de acceso al módulo inmobiliaria en res.locals ---
const setImAcceso = async (req, res, next) => {
    if (!req.session || !req.session.user) {
        res.locals.imPuedeVer = false;
        res.locals.imPuedeCrear = false;
        return next();
    }
    if (req.session.user.role === 'admin') {
        res.locals.imPuedeVer = true;
        res.locals.imPuedeCrear = true;
        return next();
    }
    try {
        const r = await pool.query(
            'SELECT puede_crear FROM im_accesos WHERE user_id = $1', [req.session.user.id]
        );
        res.locals.imPuedeVer   = r.rows.length > 0;
        res.locals.imPuedeCrear = r.rows.length > 0 && r.rows[0].puede_crear;
    } catch (_) {
        res.locals.imPuedeVer   = false;
        res.locals.imPuedeCrear = false;
    }
    next();
};

// Aplicar a todas las rutas /admin (para que el sidebar siempre tenga los flags)
router.use('/admin', setImAcceso);

// ==========================================
//              RUTAS PÚBLICAS
// ==========================================
router.get('/', mainController.home);
router.get('/propiedades', mainController.propertiesPage);
router.get('/nosotros', mainController.about);

// Contacto
router.get('/contacto', mainController.contact);
router.post('/contacto', mainController.sendContactEmail); 

// Agentes (Público)
router.get('/agentes', userController.listAgents);

// Detalle y PDF (Inmobiliaria tradicional)
router.get('/propiedad/:id', mainController.propertyDetail);
router.get('/propiedad/:id/descargar-pdf', pdfController.generatePropertyPDF);

// --- VISOR 360 PÚBLICO ---
router.get('/view/360/:slug', panoramasController.publicViewer);

// --- NUEVA RUTA: VISOR PÚBLICO DE PARCELAS (LOTIFY) ---
router.get('/proyecto/:slug', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM proyectos WHERE slug_publico = $1', [req.params.slug]);
        
        if (rows.length === 0) {
            return res.status(404).render('index', { 
                title: 'Proyecto no encontrado',
                activePage: 'home',
                error: 'El proyecto que buscas no existe o fue eliminado.'
            });
        }
        
        // Renderiza el visor público que creamos
        res.render('admin/visor-publico', { proyecto: rows[0] });
    } catch (e) {
        console.error("Error cargando proyecto público:", e);
        res.status(500).send('Error interno del servidor');
    }
});

// ==========================================
//              AUTENTICACIÓN
// ==========================================
router.get('/login', authController.loginForm);
router.post('/login', authController.login);
router.get('/logout', authController.logout);

// ==========================================
//              ÁREA PRIVADA (ADMIN)
// ==========================================
router.get('/dashboard', requireAuth, setImAcceso, dashboardController.getDashboard);

// --- INVENTARIO DE PROPIEDADES ---
router.get('/admin/propiedades', requireAuth, setImAcceso, inventoryController.getInventory);

// --- PUBLICAR PROPIEDAD ---
router.get('/admin/publicar', requireAuth, propertiesController.renderPublish);
// Ruta API para crear propiedad (coincide con frontend fetch)
router.post('/api/propiedades/crear', requireAuth, upload.array('imagenes'), propertiesController.createProperty);

// --- EDICIÓN DE PROPIEDADES ---
router.get('/admin/propiedades/editar/:id', requireAuth, editPropertyController.renderEdit);
router.post('/admin/propiedades/actualizar/:id', requireAuth, upload.array('new_images'), editPropertyController.updateProperty);

// --- ACCIONES RÁPIDAS (Estado, Eliminar, Reasignar) ---
router.post('/admin/propiedades/estado', requireAuth, propertiesController.changeStatus);
router.delete('/admin/propiedades/eliminar/:id', requireAuth, propertiesController.deleteProperty);
router.post('/admin/propiedades/reasignar', requireAuth, inventoryController.reassignAgent);

// ==========================================
//        MODULO LOTIFY (VISTAS Y API)
// ==========================================

// --- RENDERIZADO DE VISTAS (EJS) CORREGIDO ---
router.get('/admin/proyectos', requireAuth, (req, res) => {
    res.render('admin/proyectos', { user: req.session.user, page: 'proyectos' }); 
});
router.get('/admin/lotes', requireAuth, (req, res) => {
    res.render('admin/visor', { user: req.session.user, page: 'lotes' }); 
});
router.get('/admin/crm', requireAuth, (req, res) => {
    res.render('admin/crm', { user: req.session.user, page: 'crm' }); 
});

// --- API PROYECTOS ---
router.post('/api/proyectos', requireAuth, upload.single('imagen_360'), projectController.createProject); 
router.get('/api/proyectos', requireAuth, projectController.getProjects);
router.get('/api/proyectos/:id', requireAuth, projectController.getProjectById);
router.put('/api/proyectos/:id', requireAuth, upload.single('imagen_360'), projectController.updateProject);
router.delete('/api/proyectos/:id', requireAuth, projectController.deleteProject);

// --- API LOTES Y PUNTOS DE INTERÉS ---
// ¡AQUÍ ESTÁ LA ÚNICA CORRECCIÓN! Le quitamos el "requireAuth" a la línea de abajo
router.get('/api/lotes/proyecto/:projectId', loteController.getLotesByProject);
router.post('/api/lotes', requireAuth, loteController.createLote);
router.put('/api/lotes/:id', requireAuth, loteController.updateLote);
router.delete('/api/lotes/:id', requireAuth, loteController.deleteLote);

// --- API CRM (CLIENTES, VISITAS, VENTAS) ---
router.get('/api/clientes', requireAuth, crmController.getClientes);
router.post('/api/clientes', requireAuth, crmController.createCliente);
router.put('/api/clientes/:id', requireAuth, crmController.updateCliente);
router.delete('/api/clientes/:id', requireAuth, crmController.deleteCliente);

router.get('/api/visitas', requireAuth, crmController.getVisitas);
router.post('/api/visitas', requireAuth, crmController.createVisita);

router.get('/api/ventas', requireAuth, crmController.getVentas);
router.post('/api/ventas', requireAuth, crmController.createVenta);
router.get('/api/ventas/reserva/:loteId', requireAuth, crmController.getReservaByLote);

// ==========================================
//           GESTIÓN DE EQUIPO (AGENTS)
// ==========================================
// Panel de equipo
router.get('/admin/team', requireAuth, userController.manageTeam);

// Crear Agente
router.get('/admin/add-agent', requireAuth, userController.addAgentForm);
router.post('/admin/agents/create', requireAuth, userController.addAgent);

// Editar Agente
router.get('/admin/edit-agent/:id', requireAuth, userController.editAgentForm);
router.post('/admin/agents/edit', requireAuth, userController.updateAgent);

// Perfil y Eliminación
router.get('/admin/agents/profile/:id', requireAuth, userController.agentProfile);
router.delete('/admin/agents/delete/:id', requireAuth, userController.deleteAgent);

// ==========================================
//           CONFIGURACIÓN, MARCA Y VISOR 360
// ==========================================
router.get('/admin/360',                      requireAuth, panoramasController.adminPanel);
router.get('/admin/360/editor/:id',           requireAuth, panoramasController.editorPage);
router.post('/admin/360/save',                requireAuth, uploadPano.single('panorama_file'), panoramasController.savePanorama);
router.delete('/admin/360/delete/:id',        requireAuth, panoramasController.deletePanorama);

// Firma para upload directo browser → Cloudinary (evita pasar el archivo por el servidor)
router.post('/admin/360/sign-upload', requireAuth, (req, res) => {
    try {
        const timestamp = Math.round(Date.now() / 1000);
        const params    = { folder: 'cygnus_360', timestamp };
        const signature = cloudinaryV2.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
        res.json({
            signature,
            timestamp,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            apiKey:    process.env.CLOUDINARY_API_KEY,
            folder:    'cygnus_360'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/admin/configuracion', requireAuth, mainController.configPage);
router.post('/admin/configuracion/update', requireAuth, upload.array('new_banners', 5), mainController.updateConfig);

router.get('/admin/marca', requireAuth, (req, res) => {
    res.render('admin/marca', {
        title: 'Centro de Marca',
        page: 'marca',
        user: req.session.user
    });
});

// ==========================================
//     MÓDULO INMOBILIARIA DE CAMPOS
// ==========================================

// Vistas
router.get('/admin/inmobiliaria', requireAuth, async (req, res) => {
    const isAdmin = req.session.user.role === 'admin';
    let puedeCrear = isAdmin;
    let tieneAcceso = isAdmin;
    if (!isAdmin) {
        try {
            const r = await pool.query('SELECT puede_crear FROM im_accesos WHERE user_id=$1', [req.session.user.id]);
            tieneAcceso = r.rows.length > 0;
            puedeCrear  = r.rows.length > 0 && r.rows[0].puede_crear;
        } catch (_) {}
    }
    if (!tieneAcceso) return res.redirect('/dashboard');
    res.render('admin/gestion-inmobiliaria', { user: req.session.user, page: 'inmobiliaria', puedeCrear });
});
router.get('/admin/inmobiliaria/clientes', requireAuth, async (req, res) => {
    const isAdmin = req.session.user.role === 'admin';
    let tieneAcceso = isAdmin;
    if (!isAdmin) {
        try {
            const r = await pool.query('SELECT 1 FROM im_accesos WHERE user_id=$1', [req.session.user.id]);
            tieneAcceso = r.rows.length > 0;
        } catch (_) {}
    }
    if (!tieneAcceso) return res.redirect('/dashboard');
    res.render('admin/clientes-im', { user: req.session.user, page: 'clientes-im' });
});

router.get('/admin/inmobiliaria/parcela/:parcelaId', requireAuth, async (req, res) => {
    const isAdmin = req.session.user.role === 'admin';
    let puedeCrear = isAdmin;
    let tieneAcceso = isAdmin;
    if (!isAdmin) {
        try {
            const r = await pool.query('SELECT puede_crear FROM im_accesos WHERE user_id=$1', [req.session.user.id]);
            tieneAcceso = r.rows.length > 0;
            puedeCrear  = r.rows.length > 0 && r.rows[0].puede_crear;
        } catch (_) {}
    }
    if (!tieneAcceso) return res.redirect('/dashboard');
    res.render('admin/ficha-parcela', { user: req.session.user, page: 'inmobiliaria', parcelaId: req.params.parcelaId, puedeCrear });
});

// API – Proyectos Inmobiliaria
router.get('/api/im/proyectos', requireAuth, inmobiliariaController.getProyectos);
router.post('/api/im/proyectos', requireAuth, inmobiliariaController.createProyecto);
router.put('/api/im/proyectos/:id', requireAuth, inmobiliariaController.updateProyecto);
router.delete('/api/im/proyectos/:id', requireAuth, inmobiliariaController.deleteProyecto);

// API – Parcelas
router.get('/api/im/proyectos/:proyectoId/parcelas', requireAuth, inmobiliariaController.getParcelas);
router.get('/api/im/parcelas/:id', requireAuth, inmobiliariaController.getParcelaById);
router.post('/api/im/parcelas', requireAuth, inmobiliariaController.createParcela);
router.post('/api/im/parcelas/bulk', requireAuth, inmobiliariaController.createParcelasBulk);
router.put('/api/im/parcelas/:id', requireAuth, inmobiliariaController.updateParcela);
router.delete('/api/im/parcelas/:id', requireAuth, inmobiliariaController.deleteParcela);

// API – Clientes Inmobiliaria
router.get('/api/im/clientes', requireAuth, inmobiliariaController.getClientes);
router.get('/api/im/clientes/buscar', requireAuth, inmobiliariaController.buscarClientePorRut);
router.post('/api/im/clientes', requireAuth, inmobiliariaController.createCliente);
router.put('/api/im/clientes/:id', requireAuth, inmobiliariaController.updateCliente);

// API – Ventas de Lotes
router.get('/api/im/ventas',  requireAuth, inmobiliariaController.getVentas);
router.post('/api/im/ventas', requireAuth, inmobiliariaController.createVenta);
router.delete('/api/im/ventas/:id', requireAuth, inmobiliariaController.deleteVenta);
router.post('/api/im/ventas/:id/resciliar',   requireAuth, inmobiliariaController.resciliarVenta);
router.post('/api/im/ventas/:id/comprobante', requireAuth, uploadDocMemory.single('archivo'), inmobiliariaController.uploadComprobanteVenta);

// API – Cuotas de pago
router.get('/api/im/cuotas/:ventaId',           requireAuth, inmobiliariaController.getCuotas);
router.put('/api/im/cuotas/:id',                requireAuth, inmobiliariaController.updateCuota);
router.post('/api/im/cuotas/:id/comprobante',   requireAuth, uploadDocMemory.single('archivo'), inmobiliariaController.uploadComprobanteCuota);

// API – Documentos (Supabase Storage)
router.get('/api/im/documentos',          requireAuth, documentosController.getDocumentos);
router.post('/api/im/documentos',         requireAuth, uploadDocMemory.single('archivo'), documentosController.uploadDocumento);
router.patch('/api/im/documentos/:id',    requireAuth, documentosController.renameDocumento);
router.delete('/api/im/documentos/:id',   requireAuth, documentosController.deleteDocumento);

// API – Auditoría
router.get('/api/im/auditoria', requireAuth, inmobiliariaController.getAuditoria);

// API – Accesos (admin gestiona qué usuarios ven el módulo)
router.get('/api/im/usuarios',             requireAuth, inmobiliariaController.getUsuarios);
router.get('/api/im/accesos',              requireAuth, inmobiliariaController.getAccesos);
router.post('/api/im/accesos',             requireAuth, inmobiliariaController.setAcceso);
router.delete('/api/im/accesos/:userId',   requireAuth, inmobiliariaController.deleteAcceso);

router.post('/recover-password', authController.recoverPassword);
router.get('/update-password', authController.showUpdatePassword);
router.post('/update-password', authController.updatePassword);

// --- INICIO CÓDIGO SITEMAP ---
router.get('/sitemap.xml', async (req, res) => {
    try {
        // 1. Obtener propiedades publicadas
        const { data: properties, error } = await supabase
            .from('properties')
            .select('id, created_at')
            .eq('status', 'publicado');

        if (error) throw error;

        const baseUrl = 'https://cygnusgroup.cl';
        const staticUrls = [
            '',
            '/propiedades',
            '/contacto',
            '/nosotros',
            '/propiedades?operacion=Venta&region=Biobío&comuna=Concepción',
            '/propiedades?operacion=Arriendo&region=Biobío&comuna=Concepción',
            '/propiedades?operacion=Venta&region=Ñuble&comuna=Chillán'
        ];

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        // Agregar estáticas
        staticUrls.forEach(url => {
            xml += `
            <url>
                <loc>${baseUrl}${url.replace(/&/g, '&amp;')}</loc>
                <changefreq>daily</changefreq>
                <priority>0.8</priority>
            </url>`;
        });

        // Agregar propiedades dinámicas
        if (properties) {
            properties.forEach(prop => {
                const date = new Date(prop.created_at).toISOString();
                xml += `
                <url>
                    <loc>${baseUrl}/propiedad/${prop.id}</loc>
                    <lastmod>${date}</lastmod>
                    <changefreq>weekly</changefreq>
                    <priority>1.0</priority>
                </url>`;
            });
        }

        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (err) {
        console.error("Error sitemap:", err);
        res.status(500).end();
    }
});
// --- FIN CÓDIGO SITEMAP ---

module.exports = router;