/* frontend/js/visor-logic.js */
import { Viewer } from 'https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/core@5.7.3/index.module.js';
import { MarkersPlugin } from 'https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/markers-plugin@5.7.3/index.module.js';


const state = {
    viewer: null,
    markersPlugin: null,
    currentMode: null, 
    currentPoints: [],
    activeSnapPoint: null,
    editingId: null,
    tempPoiId: null,
    settings: {
        loteWidth: 4,
        caminoWidth: 15,
        caminoColor: '#ffffff',
        caminoCap: 'round',
        poiHeight: 100,
        poiSize: 2, 
        poiOrient: 'right', 
        poiBg: '#ef4444',
        poiText: '#ffffff'
    }
};

const projectId = new URLSearchParams(window.location.search).get('projectId');


const formatNumber = (input) => {
    let val = input.value.replace(/\D/g, '');
    input.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};


const showLoteError = (msg) => {
    const alertBox = document.getElementById('lote-alert');
    if(alertBox) {
        alertBox.innerText = msg;
        alertBox.style.display = 'block';
        alertBox.style.animation = 'none';
        alertBox.offsetHeight; 
        alertBox.style.animation = 'shake 0.3s';
    } else {
        showDialog('error', msg);
    }
};


const getCaminoScale = (zoom) => 0.3 + (0.5 * (zoom / 100)); 
const getLoteScale = (zoom) => 0.6 + (0.4 * (zoom / 100));


function getPolygonCenter(points) {
    if (!points || points.length === 0) return null;
    let x = 0, y = 0, z = 0;
    points.forEach(p => {
        const yaw = p[0];
        const pitch = p[1];
        x += Math.cos(pitch) * Math.cos(yaw);
        y += Math.sin(pitch);
        z += Math.cos(pitch) * Math.sin(yaw);
    });
    const len = points.length;
    x /= len; y /= len; z /= len;
    return [Math.atan2(z, x), Math.atan2(y, Math.sqrt(x * x + z * z))];
}


function updateAllMarkersScale() {
    if (!state.viewer || !state.markersPlugin) return;
    
    const currentZoom = state.viewer.getZoomLevel();
    const markers = state.markersPlugin.markers;

    for (const id in markers) {
        const m = markers[id];
        if (m.data) {
            if (m.data.tipo === 'camino') {
                const baseW = parseInt(m.data.superficie) || 15;
                const w = Math.max(3, baseW * getCaminoScale(currentZoom)); 
                state.markersPlugin.updateMarker({ 
                    id: id, 
                    svgStyle: { strokeWidth: w, stroke: m.data.color_hex || '#ffffff', strokeLinecap: m.data.lineCap || 'round', strokeOpacity: 0.8 } 
                });
            } else if (m.data.tipo === 'lote') {
                const baseW = parseInt(m.data.color_hex) || 4;
                const scaledW = Math.max(2, baseW * getLoteScale(currentZoom));
                state.markersPlugin.updateMarker({ 
                    id: id, 
                    svgStyle: { strokeWidth: scaledW, stroke: 'white', fill: 'rgba(255,255,255,0.0)' } 
                });
            } else if (m.data.tipo === 'badge') {
                const textScale = 0.7 + (0.3 * (currentZoom / 100)); 
                const el = document.querySelector(`#psv-marker-${id} .lote-badge-content`);
                if(el) el.style.transform = `translate(-50%, -50%) scale(${textScale})`;
            }
        }
    }
}


async function loadElements() {
    if (!state.markersPlugin) return;
    state.markersPlugin.clearMarkers();
    
    try {
        const elements = await getLotes(`${projectId}?t=${Date.now()}`);
        
        elements.forEach(el => {
            let puntos = el.poligono_json;
            if(typeof puntos === 'string') {
                try { puntos = JSON.parse(puntos); } catch(e){}
            }
            let pathData = Array.isArray(puntos) ? puntos : (puntos.path || []);

            if(Array.isArray(pathData) && el.tipo !== 'poi') {
                pathData.forEach((p, i) => {
                    if (Array.isArray(p) && p.length >= 2) {
                        state.markersPlugin.addMarker({ 
                            id: `snap_${el.id}_${i}`, position: { yaw: p[0], pitch: p[1] }, 
                            html: '<div class="snap-marker"></div>', anchor: 'center center', 
                            visible: false, data: { position: { yaw: p[0], pitch: p[1] }, isSnap: true, id: el.id, tipo: el.tipo } 
                        });
                    }
                });
            }
            if (!pathData) return;
            
            if(el.tipo === 'lote') renderLote(el, pathData);
            else if(el.tipo === 'camino') renderCamino(el, pathData);
            else if(el.tipo === 'poi') renderPoi(el, puntos);
        });
        
        updateAllMarkersScale();

    } catch(e) { 
        console.error("Error cargando elementos:", e);
        showDialog('error', "No se pudieron cargar los elementos.");
    }
}


function renderLote(lote, points) {
    const estado = parseInt(lote.estado_id);
    const statusColor = estado === 1 ? '#10b981' : (estado === 2 ? '#2563eb' : '#ef4444');
    const strokeW = (lote.color_hex && !isNaN(lote.color_hex)) ? parseInt(lote.color_hex) : 4;
    
    state.markersPlugin.addMarker({
        id: `poly_${lote.id}`, className: 'polygon-marker', polygonPixels: false,
        polygon: points.map(p => [p[0], p[1]]),
        svgStyle: { fill: 'rgba(255,255,255,0.0)', stroke: 'white', strokeWidth: strokeW },
        data: { ...lote, isInteractive: true, color_hex: strokeW, tipo: 'lote' }
    });

    const center = getPolygonCenter(points);
    if(center) {
        let badgeStyle = estado === 1 
            ? 'background: white; color: #1e293b; border: 2px solid white;' 
            : `background: ${statusColor}; border: 2px solid white; color: white;`;

        const badgeHtml = `
            <div class="lote-badge-wrapper">
                <div class="lote-badge-content" style="${badgeStyle}">
                    ${lote.numero_lote}
                </div>
            </div>`;

        state.markersPlugin.addMarker({
            id: `badge_${lote.id}`, position: { yaw: center[0], pitch: center[1] },
            html: badgeHtml, anchor: 'center center',
            data: { ...lote, isInteractive: true, tipo: 'badge' } 
        });
    }
}

function renderCamino(camino, points) {
    const color = camino.color_hex || '#ffffff';
    const cap = (camino.poligono_json && camino.poligono_json.cap) ? camino.poligono_json.cap : 'round';
    const baseWidth = parseInt(camino.superficie) || 15;

    state.markersPlugin.addMarker({
        id: `camino_${camino.id}`, className: 'polygon-marker', 
        polyline: points.map(p => [p[0], p[1]]),
        svgStyle: { stroke: color, strokeWidth: baseWidth, strokeLinecap: cap, strokeOpacity: 0.8 },
        data: { ...camino, isInteractive: true, tipo: 'camino', lineCap: cap }
    });
}

function getPoiHtml(title, desc, h, bg, txt, orient, size) {
    const descHtml = desc ? `<span class="poi-sub" style="color:${txt}CC">${desc}</span>` : '';
    return `
        <div class="poi-wrapper">
            <div class="poi-content ${orient} size-${size}">
                <div class="poi-head">
                     <div class="poi-pill" style="background:${bg}; color:${txt};">
                        <div style="line-height:1.2">${title}</div>
                        ${descHtml}
                    </div>
                </div>
                <div class="poi-line" style="height: ${h}px; background:${bg};"></div>
                <div class="poi-anchor" style="background:${bg};"></div>
            </div>
        </div>`;
}

function renderPoi(poi, rawData) {
    let data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    if(Array.isArray(data)) data = { yaw: data[0], pitch: data[1] };
    const h = data.height || 100; 
    const bg = data.bg || '#ef4444'; const txt = data.text || '#ffffff';
    const sizeClass = data.size || 2; 
    const orient = data.orient || 'right';

    state.markersPlugin.addMarker({
        id: `poi_${poi.id}`, position: { yaw: data.yaw, pitch: data.pitch },
        html: getPoiHtml(poi.titulo, poi.descripcion, h, bg, txt, orient, sizeClass),
        anchor: 'center center',
        data: { ...poi, isInteractive: true }
    });
}


function handleClick(pos) {
    if(state.currentMode === 'delete' || !state.currentMode) return;
    
    if(state.currentMode === 'poi') { 
        state.currentPoints = [pos.yaw, pos.pitch]; 
        state.tempPoiId = `temp_poi`; 
        
        const h = document.getElementById('poi-height').value || state.settings.poiHeight;
        const bg = document.getElementById('input-poi-bg').value || state.settings.poiBg;
        const txt = document.getElementById('input-poi-text').value || state.settings.poiText;
        
        state.markersPlugin.addMarker({
            id: state.tempPoiId, position: pos,
            html: getPoiHtml("Nuevo", "", h, bg, txt, state.settings.poiOrient, state.settings.poiSize),
            anchor: 'center center', data: { isTemp: true }
        });
        openModal('poi'); 
        return; 
    }
    
    state.currentPoints.push([pos.yaw, pos.pitch]);
    state.markersPlugin.addMarker({ 
        id: `temp_${state.currentPoints.length}`, position: pos, 
        html: '<div class="temp-point"></div>', anchor: 'center center' 
    });
    
    document.getElementById('status-text').innerText = `Puntos: ${state.currentPoints.length} (Enter para terminar)`;
    updatePreview();
}

function finishDrawing() {
    if(state.currentPoints.length < 2) {
        showDialog('error', "Debes marcar al menos 2 puntos.");
        return;
    }
    if(state.currentMode === 'camino') saveDataCamino();
    else openModal('lote'); 
}

function updatePreview() {
    try { state.markersPlugin.removeMarker('preview_poly'); } catch(e){}
    try { state.markersPlugin.removeMarker('elastic'); } catch(e){}

    if (state.currentPoints.length >= 2) {
        
        const zoom = state.viewer.getZoomLevel();
        if(state.currentMode === 'camino') {
            const w = Math.max(3, state.settings.caminoWidth * getCaminoScale(zoom));
            state.markersPlugin.addMarker({ 
                id: 'preview_poly', polyline: state.currentPoints, 
                svgStyle: { stroke: state.settings.caminoColor, strokeWidth: w, strokeOpacity: 0.8, strokeLinecap: 'butt', pointerEvents:'none' } 
            });
        } else if (state.currentMode === 'lote') {
            const w = Math.max(2, state.settings.loteWidth * getLoteScale(zoom));
            state.markersPlugin.addMarker({ 
                id: 'preview_poly', polygon: state.currentPoints, 
                svgStyle: { fill: 'transparent', stroke: 'white', strokeWidth: w, pointerEvents:'none' } 
            });
        }
    }
}


async function saveData() {
    const alertBox = document.getElementById('lote-alert');
    alertBox.style.display = 'none';

    const numero = document.getElementById('input-numero').value.trim();
    if(!numero) { showLoteError("⚠️ Ingresa un número de lote primero."); return; }

    const duplicate = Object.values(state.markersPlugin.markers).find(m => m.data && m.data.tipo === 'lote' && m.data.numero_lote === numero && (!state.editingId || m.data.id != state.editingId));
    if(duplicate) { showLoteError(`⚠️ El Lote "${numero}" ya existe en este proyecto.`); return; }

    const precioRaw = document.getElementById('input-precio').value;
    const superficieRaw = document.getElementById('input-superficie').value;

    if (!precioRaw) { showLoteError("⚠️ El precio es obligatorio y debe ser un número."); return; }
    if (!superficieRaw) { showLoteError("⚠️ La superficie es obligatoria y debe ser numérica."); return; }

    try {
        const precio = precioRaw.replace(/\./g, '');
        const superficie = superficieRaw.replace(/\./g, '');
        const estado = document.getElementById('input-estado').value;
        const currentLoteWidth = parseInt(document.getElementById('lote-width').value) || 4;

        const payload = { 
            proyecto_id: projectId, numero_lote: numero, estado_id: parseInt(estado) || 1, 
            precio: precio, superficie: superficie, 
            poligono_json: state.currentPoints, tipo: 'lote',
            color: currentLoteWidth.toString() 
        };
        
        if(state.editingId) await updateLote(state.editingId, payload); else await saveLote(payload);
        closeModal(); setMode(null); loadElements();
    } catch (err) { console.error(err); showDialog('error', 'Error al guardar: ' + err.message); }
}

async function saveDataCamino() {
    try {
        const dataToSave = { path: state.currentPoints, cap: state.settings.caminoCap };
        const currentCaminoWidth = parseInt(document.getElementById('camino-width').value) || 15;
        const currentColor = document.getElementById('camino-color').value || '#ffffff';

        await saveLote({ 
            proyecto_id: projectId, numero_lote: 'Camino', tipo: 'camino', 
            superficie: currentCaminoWidth, color: currentColor, poligono_json: dataToSave 
        });
        setMode(null); loadElements();
    } catch(e) { showDialog('error', 'Error al guardar camino: ' + e.message); }
}

async function savePoiData() {
    if (!state.currentPoints || state.currentPoints.length < 2) { showDialog('error', "Error: Coordenadas perdidas."); return; }
    
    const titulo = document.getElementById('input-poi-titulo').value.trim();
    if(!titulo) { showDialog('error', "El título del punto es obligatorio."); return; }

    try {
        const sub = document.getElementById('input-poi-desc').value;
        const height = document.getElementById('poi-height').value;
        const bg = document.getElementById('input-poi-bg').value;
        const text = document.getElementById('input-poi-text').value;
        
        const dataToSave = { 
            yaw: state.currentPoints[0], pitch: state.currentPoints[1], 
            height, bg, text, size: state.settings.poiSize, orient: state.settings.poiOrient 
        };
        const payload = { proyecto_id: projectId, titulo: titulo, descripcion: sub, poligono_json: dataToSave, tipo: 'poi' };
        
        if(state.editingId) await deleteLote(state.editingId); 
        await saveLote(payload); 
        
        await loadElements();
        closeModal(); 
    } catch (err) { showDialog('error', err.message); }
}

async function deleteElement() { 
    if(state.editingId) { await deleteLote(state.editingId); closeModal(); loadElements(); } 
}

// --- 8. MODOS Y UI ---
function setMode(mode) {
    state.currentPoints.forEach((_, i) => { try{ state.markersPlugin.removeMarker(`temp_${i+1}`); }catch(e){} });
    try{ state.markersPlugin.removeMarker('preview_poly'); }catch(e){}
    try{ state.markersPlugin.removeMarker('elastic'); }catch(e){}
    state.currentPoints = [];
    state.editingId = null;

    document.body.classList.remove('drawing', 'deleting');
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('show'));
    document.getElementById('status-bar').classList.remove('show');
    document.getElementById('undo-legend').classList.remove('show');

    const snaps = Object.values(state.markersPlugin.markers).filter(m => m.id.startsWith('snap_'));
    state.currentMode = mode;

    if (mode) {
        const btnId = mode === 'delete' ? 'btn-delete-tool' : `btn-${mode}`;
        document.getElementById(btnId).classList.add('active');

        if (mode === 'delete') {
            document.body.classList.add('deleting');
            snaps.forEach(m => state.markersPlugin.updateMarker({ id: m.id, visible: false }));
        } else {
            document.body.classList.add('drawing');
            document.getElementById('status-bar').classList.add('show');
            document.getElementById('status-text').innerText = 'Haga clic para comenzar';
            
            if(mode === 'lote' || mode === 'camino' || mode === 'poi') {
                document.getElementById('undo-legend').classList.add('show');
            }

            if (mode === 'camino' || mode === 'lote') snaps.forEach(m => state.markersPlugin.updateMarker({ id: m.id, visible: true }));
            else snaps.forEach(m => state.markersPlugin.updateMarker({ id: m.id, visible: false }));

            if (mode === 'lote') document.getElementById('lote-settings').classList.add('show');
            if (mode === 'camino') document.getElementById('camino-settings').classList.add('show');
            if (mode === 'poi') document.getElementById('poi-settings').classList.add('show');
        }
    } else {
        state.activeSnapPoint = null;
        snaps.forEach(m => state.markersPlugin.updateMarker({ id: m.id, visible: false }));
    }
}

function openModal(type) {
    document.getElementById('btn-lote-delete').style.display = state.editingId ? 'block' : 'none';
    document.getElementById('btn-poi-delete').style.display = state.editingId ? 'block' : 'none';
    if(type === 'poi') document.getElementById('poi-editor-panel').classList.add('active');
    else document.getElementById(`modal-${type}`).classList.add('active');
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    document.getElementById('poi-editor-panel').classList.remove('active');
    document.getElementById('lote-alert').style.display = 'none';
    if(state.tempPoiId) { try { state.markersPlugin.removeMarker(state.tempPoiId); } catch(e){} state.tempPoiId = null; }
    state.editingId = null;
}

window.updateSettings = (type) => {
    if(type === 'lote') {
        state.settings.loteWidth = parseInt(document.getElementById('lote-width').value) || 4;
        document.getElementById('disp-lote-width').innerText = state.settings.loteWidth;
    } else if(type === 'camino') {
        state.settings.caminoWidth = parseInt(document.getElementById('camino-width').value) || 15;
        state.settings.caminoColor = document.getElementById('camino-color').value;
        document.getElementById('disp-camino-width').innerText = state.settings.caminoWidth;
    } else if(type === 'poi') {
        state.settings.poiHeight = parseInt(document.getElementById('poi-height').value) || 100;
        document.getElementById('disp-poi-height').innerText = state.settings.poiHeight;
        
        const idTarget = state.tempPoiId || (state.editingId ? `poi_${state.editingId}` : null);
        if(idTarget) {
            const h = state.settings.poiHeight;
            const bg = document.getElementById('input-poi-bg').value;
            const txt = document.getElementById('input-poi-text').value;
            const title = document.getElementById('input-poi-titulo').value || 'Título';
            const desc = document.getElementById('input-poi-desc').value || '';
            try {
                state.markersPlugin.updateMarker({ id: idTarget, html: getPoiHtml(title, desc, h, bg, txt, state.settings.poiOrient, state.settings.poiSize) });
            } catch(e){}
        }
    }
    
    updatePreview();
}


async function init() {
    if(!projectId) { showDialog('error', "Error: No hay proyecto seleccionado"); return; }
    
    if (typeof window.getProjectById !== 'function') {
        console.warn("API functions not ready, waiting...");
        await new Promise(r => setTimeout(r, 500));
    }

    try {
        const project = await window.getProjectById(projectId);
        document.getElementById('project-title').innerText = project.nombre;

        state.viewer = new Viewer({
            container: document.getElementById('viewer'),
            panorama: project.imagen_360_url,
            navbar: false, 
            defaultZoomLvl: 0, 
            mousewheel: true,
            plugins: [[MarkersPlugin, { markers: [] }]]
        });

        state.markersPlugin = state.viewer.getPlugin(MarkersPlugin);

        state.viewer.addEventListener('ready', () => { loadElements(); }, { once: true });
        state.viewer.addEventListener('click', ({ data }) => { if(!state.activeSnapPoint) handleClick(data); });
        state.viewer.addEventListener('zoom-updated', updateAllMarkersScale);
        
        state.viewer.addEventListener('mousemove', ({ data }) => {
            if(state.currentMode && state.currentPoints.length > 0 && state.currentMode !== 'poi') {
                const lastPt = state.currentPoints[state.currentPoints.length-1];
                const dest = state.activeSnapPoint ? state.activeSnapPoint : { yaw: data.yaw, pitch: data.pitch };
                try { state.markersPlugin.removeMarker('elastic'); } catch(e){}
                
                // FIX: Usamos las mismas funciones de escala para la goma elástica
                const zoom = state.viewer.getZoomLevel();
                let strokeW, strokeC;
                
                if (state.currentMode === 'lote') {
                    strokeW = Math.max(2, state.settings.loteWidth * getLoteScale(zoom));
                    strokeC = 'white';
                } else {
                    strokeW = Math.max(3, state.settings.caminoWidth * getCaminoScale(zoom));
                    strokeC = state.settings.caminoColor;
                }

                state.markersPlugin.addMarker({ 
                    id: 'elastic', 
                    polyline: [[lastPt[0], lastPt[1]], [dest.yaw, dest.pitch]], 
                    svgStyle: { stroke: strokeC, strokeWidth: strokeW, strokeDasharray: '5,5', strokeLinecap: 'butt', pointerEvents: 'none' } 
                });
            }
        });

        state.markersPlugin.addEventListener('select-marker', ({ marker }) => {
            if(state.currentMode === 'delete') {
                state.editingId = marker.data.id;
                const label = marker.data.tipo === 'poi' ? 'Punto' : (marker.data.tipo === 'camino' ? 'Camino' : 'Lote');
                showDialog('confirm', `¿Eliminar ${label}?`, deleteElement);
                return;
            }
            if (state.currentMode && (state.currentMode === 'lote' || state.currentMode === 'camino') && marker.id.startsWith('snap_')) { 
                handleClick(marker.data.position); return; 
            }
            if (!state.currentMode && marker.data && marker.data.isInteractive) {
                state.editingId = marker.data.id;
                if(marker.data.tipo === 'poi') {
                    let rawPoints = typeof marker.data.poligono_json === 'string' ? JSON.parse(marker.data.poligono_json) : marker.data.poligono_json;
                    const info = rawPoints;
                    state.currentPoints = [info.yaw, info.pitch];
                    document.getElementById('input-poi-titulo').value = marker.data.titulo;
                    document.getElementById('input-poi-desc').value = marker.data.descripcion || '';
                    document.getElementById('poi-height').value = info.height || 100;
                    document.getElementById('input-poi-bg').value = info.bg || '#ef4444';
                    document.getElementById('input-poi-text').value = info.text || '#ffffff';
                    state.settings.poiSize = info.size || 2;
                    state.settings.poiOrient = info.orient || 'right';
                    document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
                    setMode('poi'); document.body.classList.remove('drawing'); openModal('poi');
                } else if (marker.data.tipo === 'lote' || marker.data.tipo === 'badge') {
                    document.getElementById('input-numero').value = marker.data.numero_lote;
                    document.getElementById('input-precio').value = parseInt(marker.data.precio).toLocaleString('es-CL');
                    document.getElementById('input-superficie').value = parseInt(marker.data.superficie).toLocaleString('es-CL');
                    document.getElementById('input-estado').value = marker.data.estado_id;
                    const savedWidth = parseInt(marker.data.color_hex) || 4;
                    document.getElementById('lote-width').value = savedWidth;
                    document.getElementById('disp-lote-width').innerText = savedWidth;
                    state.settings.loteWidth = savedWidth;
                    let rawPoints = typeof marker.data.poligono_json === 'string' ? JSON.parse(marker.data.poligono_json) : marker.data.poligono_json;
                    state.currentPoints = Array.isArray(rawPoints) ? rawPoints : (rawPoints.path || []);
                    openModal('lote');
                } else {
                    showDialog('confirm', '¿Eliminar Camino?', deleteElement);
                }
            }
        });

        state.markersPlugin.addEventListener('enter-marker', ({ marker }) => { if (marker.id.startsWith('snap_')) state.activeSnapPoint = marker.data.position; });
        state.markersPlugin.addEventListener('leave-marker', ({ marker }) => { if (marker.id.startsWith('snap_')) state.activeSnapPoint = null; });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && state.currentMode) finishDrawing();
            if (e.key === 'Escape') { setMode(null); closeModal(); loadElements(); }
            if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
                if (state.currentPoints.length > 0) { 
                    try{ state.markersPlugin.removeMarker(`temp_${state.currentPoints.length}`); }catch(e){}
                    state.currentPoints.pop(); 
                    document.getElementById('status-text').innerText = `Puntos: ${state.currentPoints.length}`;
                    updatePreview(); 
                } 
            }
        });

    } catch (error) { 
        console.error(error);
        showDialog('error', 'Error crítico en el visor: ' + error.message);
    }
}

function showDialog(type, message, onConfirm) {
    const overlay = document.getElementById('dialog-overlay');
    overlay.classList.add('active');
    document.getElementById('dialog-message').innerText = message;
    const btns = document.getElementById('dialog-buttons');
    btns.innerHTML = '';
    
    if(type === 'confirm') {
        document.querySelector('.dialog-icon').className = 'bi bi-question-circle-fill dialog-icon';
        document.querySelector('.dialog-icon').style.color = '#f59e0b';
        document.querySelector('.dialog-title').innerText = 'Confirmar Acción';
        
        btns.innerHTML = `<button class="btn-dialog cancel" onclick="closeModal()">Cancelar</button><button class="btn-dialog danger" id="btn-confirm-action">Eliminar</button>`;
        document.getElementById('btn-confirm-action').onclick = () => { onConfirm(); closeModal(); };
    } else {
        document.querySelector('.dialog-icon').className = 'bi bi-exclamation-triangle-fill dialog-icon';
        document.querySelector('.dialog-icon').style.color = '#ef4444';
        document.querySelector('.dialog-title').innerText = 'Atención';
        
        btns.innerHTML = `<button class="btn-dialog confirm" onclick="closeModal()">Aceptar</button>`;
    }
}


window.setMode = setMode;
window.handleClick = handleClick;
window.finishDrawing = finishDrawing;
window.cancelDrawing = () => { setMode(null); closeModal(); loadElements(); };
window.undoLastPoint = () => window.dispatchEvent(new KeyboardEvent('keydown', {'key': 'z', 'ctrlKey': true}));
window.saveData = saveData;
window.savePoi = savePoiData;
window.confirmDelete = () => showDialog('confirm', '¿Eliminar elemento?', deleteElement);
window.closeModal = closeModal;
window.deleteElement = deleteElement;
window.formatNumber = formatNumber;
window.updateActivePoi = () => window.updateSettings('poi');
window.setLineCap = (cap) => {
    state.settings.caminoCap = cap;
    document.getElementById('btn-cap-round').classList.remove('active');
    document.getElementById('btn-cap-square').classList.remove('active');
    document.getElementById(`btn-cap-${cap}`).classList.add('active');
    updatePreview();
};
window.setPoiOrient = (orient) => {
    state.settings.poiOrient = orient;
    document.getElementById('btn-orient-left').classList.remove('active');
    document.getElementById('btn-orient-right').classList.remove('active');
    document.getElementById(`btn-orient-${orient}`).classList.add('active');
    window.updateSettings('poi');
};
window.setPoiSize = (size, btn) => {
    state.settings.poiSize = size;
    document.querySelectorAll('.segment-btn').forEach(b => { 
        if(b.textContent.includes('S') || b.textContent.includes('M') || b.textContent.includes('L')) b.classList.remove('active'); 
    });
    btn.classList.add('active');
    window.updateSettings('poi');
};

window.addEventListener('load', init);