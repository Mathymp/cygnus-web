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

// --- IMPORTAR CONTROLADORES LOTIFY ---
const projectController = require('../controllers/projectController');
const loteController = require('../controllers/loteController');
const crmController = require('../controllers/crmController');

// --- CONFIGURACIÓN DE UPLOAD ---
const upload = require('../config/cloudinaryConfig');

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
        res.render('visor-publico', { proyecto: rows[0] });
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
router.get('/dashboard', requireAuth, dashboardController.getDashboard);

// --- INVENTARIO DE PROPIEDADES ---
router.get('/admin/propiedades', requireAuth, inventoryController.getInventory);

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
    // Si no trae el projectId exacto que necesita tu JS, lo devolvemos
    if (!req.query.projectId) {
        return res.redirect('/admin/proyectos');
    }
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
router.get('/api/lotes/proyecto/:projectId', requireAuth, loteController.getLotesByProject);
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
//           CONFIGURACIÓN Y MARCA
// ==========================================
router.get('/admin/configuracion', requireAuth, mainController.configPage);
router.post('/admin/configuracion/update', requireAuth, upload.array('new_banners', 5), mainController.updateConfig);

router.get('/admin/marca', requireAuth, (req, res) => {
    res.render('admin/marca', {
        title: 'Centro de Marca',
        page: 'marca',
        user: req.session.user
    });
});

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