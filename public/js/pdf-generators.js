/* public/js/pdf-generators.js */

// Función puente: abre una pestaña nueva forzando la descarga del binario
const triggerDownload = (url) => {
    window.open(url, '_blank');
};

/**
 * GENERAR ORDEN DE VISITA
 * Se asegura de que nombre y rut no vengan vacíos.
 */
window.createVisitPDF = function(prop, cName, cRut) {
    if (!prop || !prop.id) {
        Swal.fire('Error', 'Propiedad no identificada', 'error');
        return;
    }
    
    // Validación suave
    if (!cName || !cRut) {
        Swal.fire({
            title: 'Datos Faltantes',
            text: 'Por favor ingresa Nombre y RUT del cliente.',
            icon: 'warning'
        });
        return;
    }

    Swal.fire({
        title: 'Generando Orden...',
        text: 'Preparando documento PDF...',
        icon: 'info',
        timer: 2000,
        showConfirmButton: false
    });

    const url = `/propiedad/${prop.id}/descargar-pdf?type=orden&cName=${encodeURIComponent(cName)}&cRut=${encodeURIComponent(cRut)}`;
    triggerDownload(url);
};

/**
 * GENERAR FICHA TÉCNICA
 */
window.createBrochurePDF = function(prop) {
    if (!prop || !prop.id) return;

    Swal.fire({
        title: 'Descargando Ficha...',
        text: 'Generando PDF completo...',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
    });

    const url = `/propiedad/${prop.id}/descargar-pdf?type=brochure`;
    triggerDownload(url);
};