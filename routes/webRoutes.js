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

// --- RUTAS PÚBLICAS ---
router.get('/', mainController.home);
router.get('/propiedades', mainController.propertiesPage);
router.get('/nosotros', mainController.about);
// Contacto: GET para ver formulario, POST para enviar
router.get('/contacto', mainController.contact);
router.post('/contacto', mainController.sendContactEmail); 

router.get('/agentes', userController.listAgents);
router.get('/propiedad/:id', mainController.propertyDetail);
router.get('/propiedad/:id/descargar-pdf', pdfController.generatePropertyPDF);

// --- AUTH ---
router.get('/login', authController.loginForm); 
router.post('/login', authController.login);
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- DASHBOARD ---
router.get('/dashboard', requireAuth, dashboardController.getDashboard);

// --- GESTIÓN PROPIEDADES (CRUD) ---
router.get('/admin/propiedades', inventoryController.getInventory);

// Publicar
router.get('/admin/publicar', requireAuth, propertiesController.renderPublish);
router.post('/api/propiedades/crear', requireAuth, upload.array('imagenes'), propertiesController.createProperty);

// Editar
router.get('/admin/editar-propiedad/:id', requireAuth, editPropertyController.renderEdit);
router.post('/admin/propiedades/actualizar/:id', requireAuth, upload.array('new_images'), editPropertyController.updateProperty);

// Acciones Rápidas
router.post('/admin/propiedades/estado', requireAuth, propertiesController.changeStatus);
router.delete('/admin/propiedades/eliminar/:id', requireAuth, propertiesController.deleteProperty);
router.post('/admin/propiedades/reasignar', requireAuth, inventoryController.reassignAgent);

// --- EQUIPO ---
router.get('/admin/team', requireAuth, userController.manageTeam);
router.get('/admin/add-agent', requireAuth, userController.showCreateForm);
router.post('/admin/add-agent', requireAuth, userController.createAgent);
router.get('/admin/edit-agent/:id', requireAuth, userController.showEditForm);
router.post('/admin/edit-agent/:id', requireAuth, userController.updateAgent);
router.post('/admin/delete-agent/:id', requireAuth, userController.deleteAgent);

// --- CONFIGURACIÓN DEL SITIO ---
router.get('/admin/configuracion', requireAuth, mainController.configPage);
router.post('/admin/configuracion/update', requireAuth, upload.array('new_banners', 5), mainController.updateConfig);

// --- CENTRO DE MARCA ---
router.get('/admin/marca', requireAuth, (req, res) => {
    res.render('admin/marca', {
        title: 'Centro de Marca | Cygnus Group',
        user: req.session.user,
        activePage: 'marca', 
        path: '/admin/marca'
    });
});

module.exports = router;