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
// CORREGIDO: .viewDashboard -> .getDashboard
router.get('/dashboard', requireAuth, dashboardController.getDashboard);

// --- INVENTARIO DE PROPIEDADES ---
// CORREGIDO: .manageInventory -> .getInventory
router.get('/admin/propiedades', requireAuth, inventoryController.getInventory);

router.get('/admin/publicar', requireAuth, propertiesController.renderPublish);

// CORREGIDO: .publishProperty -> .createProperty
router.post('/admin/publicar', requireAuth, upload.array('images'), propertiesController.createProperty);

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
router.post('/admin/agents/create', requireAuth, userController.addAgent);

// Editar Agente
router.get('/admin/edit-agent/:id', requireAuth, userController.editAgentForm);
router.post('/admin/agents/edit', requireAuth, userController.updateAgent);

// Perfil y Eliminación
router.get('/admin/agents/profile/:id', requireAuth, userController.agentProfile);
router.post('/admin/agents/delete/:id', requireAuth, userController.deleteAgent);

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

module.exports = router;