const API_URL = 'http://localhost:3000/api';
const getToken = () => localStorage.getItem('userToken');


async function handleResponse(res) {
  let data = {};
  
  
  try {
      const resClone = res.clone(); 
      const text = await resClone.text();
      if (text.length > 0) {
          data = JSON.parse(text);
      }
  } catch (e) {
     
  }


  if (!res.ok) {

      if (res.status === 401) {
          if (data.message) {
              throw new Error(data.message);
          }
          localStorage.removeItem('userToken');
          
          if (window.location.pathname.indexOf('index.html') === -1) {
              alert("⚠️ Sesión expirada. Por favor ingresa nuevamente.");
              window.location.href = 'index.html';
          }
          throw new Error('Sesión requerida');
      }

      const errorMessage = data.message || `Error del sistema: ${res.status}`;
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
            throw new Error("❌ Error de conexión: El servidor no responde. Revisa si el backend está encendido.");
        }
        throw e;
    }
}



async function registerUser(nombre_usuario, email, password) {
  const data = await safeFetch(`${API_URL}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre_usuario, email, password })
  });
  
  if (!data.token) throw new Error('Error: El servidor no devolvió un token válido.');
  return data;
}

async function loginUser(email, password) {
  const data = await safeFetch(`${API_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  if (!data.token) throw new Error('Error: El servidor no devolvió un token válido.');
  return data;
}


async function getProjects() {
  return await safeFetch(`${API_URL}/projects`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
}

async function createProject(formData) {
  
  const res = await fetch(`${API_URL}/projects`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` },
    body: formData
  });
  return await handleResponse(res);
}


async function updateProject(id, formData) {
    const res = await fetch(`${API_URL}/projects/${id}`, {
        method: 'PUT', 
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData
    });
    return await handleResponse(res);
}

async function getProjectById(id) {
  return await safeFetch(`${API_URL}/projects/${id}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
}

async function deleteProject(id) {
  const res = await fetch(`${API_URL}/projects/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
  
  if (!res.ok) await handleResponse(res);
}



async function saveLote(loteData) {
    const res = await fetch(`${API_URL}/lotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify(loteData)
    });
    return await handleResponse(res);
}

async function getLotes(projectId) {
    return await safeFetch(`${API_URL}/lotes/${projectId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
}

async function updateLote(id, loteData) {
    const res = await fetch(`${API_URL}/lotes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify(loteData)
    });
    return await handleResponse(res);
}

async function deleteLote(id) {
    const res = await fetch(`${API_URL}/lotes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!res.ok) await handleResponse(res);
}