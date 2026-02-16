const express = require('express');
const router = express.Router();

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

// --- CONFIGURACIÓN DE UPLOAD ---
const upload = require('../config/cloudinaryConfig');

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

// Detalle y PDF
router.get('/propiedad/:id', mainController.propertyDetail);
router.get('/propiedad/:id/descargar-pdf', pdfController.generatePropertyPDF);

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
//           GESTIÓN DE EQUIPO (AGENTS)
// ==========================================
// Panel de equipo
router.get('/admin/team', requireAuth, userController.manageTeam);

// Crear Agente
router.get('/admin/add-agent', requireAuth, userController.addAgentForm);
// RUTA CORREGIDA PARA CREAR AGENTE:
router.post('/admin/agents/create', requireAuth, userController.addAgent);

// Editar Agente
router.get('/admin/edit-agent/:id', requireAuth, userController.editAgentForm);
router.post('/admin/agents/edit', requireAuth, userController.updateAgent);

// Perfil y Eliminación
router.get('/admin/agents/profile/:id', requireAuth, userController.agentProfile);
// Usamos DELETE si es fetch, POST si es form normal, aquí mantengo DELETE para fetch
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
// --- AGREGAR EN routes/webRoutes.js ---

// --- INICIO CÓDIGO SITEMAP (PEGA ESTO AL FINAL DE webRoutes.js, ANTES DEL EXPORT) ---

// Asegúrate de que 'supabase' esté importado arriba en este archivo. 
// Si no está, agrega: const supabase = require('../config/supabaseClient');

router.get('/sitemap.xml', async (req, res) => {
    try {
        // 1. Obtener propiedades publicadas
        const { data: properties, error } = await supabase
            .from('properties') // Asegúrate que tu tabla se llama 'properties'
            .select('id, created_at') // Usamos created_at o updated_at
            .eq('status', 'publicado'); // Solo las publicadas

        if (error) throw error;

        const baseUrl = 'https://cygnusgroup.cl'; // TU DOMINIO REAL
        const staticUrls = [
            '',
            '/propiedades',
            '/contacto',
            '/nosotros',
            // URLs SEO estratégicas
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