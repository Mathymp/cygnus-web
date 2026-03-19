// =========================================================
// API.JS - CORREGIDO PARA CYGNUS GROUP (SIN LOCALHOST)
// =========================================================

// Cambiamos localhost por ruta relativa. Así funciona en tu PC y en Render automáticamente.
const API_URL = '/api'; 

async function handleResponse(res) {
  let data = {};
  
  try {
      const resClone = res.clone(); 
      const text = await resClone.text();
      if (text.length > 0) {
          data = JSON.parse(text);
      }
  } catch (e) {
     // No es JSON, continuamos
  }

  if (!res.ok) {
      // Manejo de sesión expirada integrado con Cygnus
      if (res.status === 401 || res.status === 403) {
          if (window.location.pathname.indexOf('login') === -1) {
              window.location.href = '/login';
          }
          throw new Error('Sesión requerida o sin permisos');
      }

      const errorMessage = data.message || data.error || `Error del sistema: ${res.status}`;
      throw new Error(errorMessage);
  }

  return data;
}

const safeFetch = async (url, options = {}) => {
    try {
        const res = await fetch(url, options);
        return await handleResponse(res);
    } catch (e) {
        if (e.message.includes('Failed to fetch')) {
            throw new Error("❌ Error de conexión: El servidor no responde. Revisa tu conexión.");
        }
        throw e;
    }
}

// ==========================================
// PROYECTOS 360 (Conectado a /api/proyectos)
// ==========================================

async function getProjects() {
  return await safeFetch(`${API_URL}/proyectos`);
}

async function createProject(formData) {
  const res = await fetch(`${API_URL}/proyectos`, {
    method: 'POST',
    body: formData
  });
  return await handleResponse(res);
}

async function updateProject(id, formData) {
    const res = await fetch(`${API_URL}/proyectos/${id}`, {
        method: 'PUT', 
        body: formData
    });
    return await handleResponse(res);
}

async function getProjectById(id) {
  return await safeFetch(`${API_URL}/proyectos/${id}`);
}

async function deleteProject(id) {
  const res = await fetch(`${API_URL}/proyectos/${id}`, {
    method: 'DELETE'
  });
  
  if (!res.ok && res.status !== 204) await handleResponse(res);
}

// ==========================================
// LOTES Y POIs (Conectado a /api/lotes)
// ==========================================

async function saveLote(loteData) {
    const res = await fetch(`${API_URL}/lotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loteData)
    });
    return await handleResponse(res);
}

async function getLotes(projectId) {
    // La ruta en webRoutes.js era /api/lotes/proyecto/:projectId
    return await safeFetch(`${API_URL}/lotes/proyecto/${projectId}`);
}

async function updateLote(id, loteData) {
    const res = await fetch(`${API_URL}/lotes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loteData)
    });
    return await handleResponse(res);
}

async function deleteLote(id) {
    const res = await fetch(`${API_URL}/lotes/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok && res.status !== 204) await handleResponse(res);
}

// (Opcional) Funciones de auth antiguas por si algún script viejo las llama
async function registerUser() { throw new Error("Usar panel de admin de Cygnus"); }
async function loginUser() { throw new Error("Usar panel de admin de Cygnus"); }