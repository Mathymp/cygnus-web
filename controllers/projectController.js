const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Conexión nativa a la base de datos de Cygnus
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const isAdmin = async (req) => {
    // En Cygnus, el rol ya viene en la sesión
    return req.session.user && req.session.user.role === 'admin';
};

exports.createProject = async (req, res) => {
  try {
    if (!(await isAdmin(req))) {
        return res.status(403).json({ message: 'Solo los administradores pueden crear proyectos.' });
    }

    const { nombre, descripcion, localidad } = req.body;
    const usuario_id = req.session.user.id; // Variable de Cygnus (UUID)

    if (!req.file) return res.status(400).json({ message: 'Falta imagen 360.' });
    const imagen_360_url = req.file.path; // Al usar Cloudinary, esto guardará la URL

    const slug_random = crypto.randomBytes(4).toString('hex');
    const slug_publico = `${nombre.replace(/\s+/g, '-').toLowerCase()}-${slug_random}`;

    const result = await pool.query(
      `INSERT INTO proyectos (usuario_id, nombre, descripcion, imagen_360_url, slug_publico, localidad)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [usuario_id, nombre, descripcion, imagen_360_url, slug_publico, localidad || '']
    );

    res.status(201).json({
      message: 'Proyecto creado',
      nuevoProyectoId: result.rows[0].id,
      proyecto: { id: result.rows[0].id, nombre, imagen_360_url }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error servidor', error: error.message });
  }
};

exports.getProjects = async (req, res) => {
  try {
    // CORRECCIÓN PARA CYGNUS: Usamos la tabla "users" en lugar de "usuarios".
    // Si es admin, traemos todos los proyectos con el nombre del creador.
    let query;
    let params = [];

    if (await isAdmin(req)) {
        query = `
            SELECT p.*, u.name as creador_nombre 
            FROM proyectos p
            LEFT JOIN users u ON p.usuario_id = u.id
            ORDER BY p.creado_en DESC
        `;
    } else {
        // Por si en el futuro decides que los agentes también puedan tener proyectos
        query = `
            SELECT p.*, u.name as creador_nombre 
            FROM proyectos p
            LEFT JOIN users u ON p.usuario_id = u.id
            WHERE p.usuario_id = $1 
            ORDER BY p.creado_en DESC
        `;
        params.push(req.session.user.id);
    }
    
    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(`❌ Error al obtener proyectos: ${error.message}`);
    res.status(500).json({ message: 'Error servidor', error: error.message });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    let query;
    let params = [req.params.id];

    // CORRECCIÓN: Filtros adaptados a la tabla de Cygnus
    if (await isAdmin(req)) {
        query = `SELECT p.* FROM proyectos p WHERE p.id = $1`;
    } else {
        query = `SELECT p.* FROM proyectos p WHERE p.id = $1 AND p.usuario_id = $2`;
        params.push(req.session.user.id);
    }

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) return res.status(404).json({ message: 'No encontrado' });
    res.status(200).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error servidor', error: error.message });
  }
};

exports.updateProject = async (req, res) => {
  try {
    if (!(await isAdmin(req))) {
        return res.status(403).json({ message: 'Solo administradores pueden editar la configuración del proyecto.' });
    }

    const { id } = req.params;
    const { nombre, descripcion, localidad } = req.body;

    if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio' });

    let oldImagePath = null;
    if (req.file) {
      // Como es admin, quitamos la restricción de que solo pueda editar si él lo creó
      const currentProject = await pool.query(
        'SELECT imagen_360_url FROM proyectos WHERE id = $1',
        [id]
      );
      if (currentProject.rows.length > 0) {
        oldImagePath = currentProject.rows[0].imagen_360_url;
      }
    }

    let query = 'UPDATE proyectos SET nombre = $1, descripcion = $2, localidad = $3';
    let values = [nombre, descripcion || '', localidad || ''];
    let counter = 4; 

    if (req.file) {
      query += `, imagen_360_url = $${counter}`;
      values.push(req.file.path);
      counter++;
    }

    query += ` WHERE id = $${counter} RETURNING *`;
    values.push(id);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Proyecto no encontrado.' });
    }

    // Cloudinary maneja URLs, fs.unlink fallará silenciosamente (lo cual es seguro)
    if (oldImagePath && req.file && !oldImagePath.startsWith('http')) {
      try {
        await fs.unlink(oldImagePath);
        console.log(`✅ Imagen anterior eliminada: ${oldImagePath}`);
      } catch (err) {
        console.warn(`⚠️ No se pudo eliminar la imagen anterior: ${err.message}`);
      }
    }

    res.json({ message: 'Proyecto actualizado', project: result.rows[0] });

  } catch (error) {
    console.error('❌ Error al actualizar:', error);
    res.status(500).json({ message: 'Error al actualizar', error: error.message });
  }
};

exports.deleteProject = async (req, res) => {
  const client = await pool.connect();
  
  try {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ message: 'No tienes permiso para eliminar proyectos.' });
    }

    const { id } = req.params;

    await client.query('BEGIN');

    // Al ser admin, puede eliminar cualquier proyecto
    const projectResult = await client.query(
      'SELECT imagen_360_url FROM proyectos WHERE id = $1',
      [id]
    );

    if (projectResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No encontrado.' });
    }

    const imagePath = projectResult.rows[0].imagen_360_url;

    await client.query('DELETE FROM ventas WHERE proyecto_id = $1', [id]);
    
    try {
      await client.query('DELETE FROM lotes WHERE proyecto_id = $1', [id]);
    } catch (err) {
      console.log('⚠️ Tabla "lotes" no existe o no tiene FK a proyectos:', err.message);
    }
    
    const deleteResult = await client.query(
      'DELETE FROM proyectos WHERE id = $1 RETURNING id',
      [id]
    );

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No encontrado.' });
    }

    if (imagePath && !imagePath.startsWith('http')) {
      try {
        await fs.unlink(imagePath);
        console.log(`✅ Imagen eliminada: ${imagePath}`);
      } catch (err) {
        console.warn(`⚠️ No se pudo eliminar la imagen: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    res.status(204).send();
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al eliminar proyecto:', error);
    
    let errorMessage = 'Error al eliminar el proyecto';
    if (error.code === '23503') {
      errorMessage = 'No se puede eliminar el proyecto porque tiene datos relacionados (ventas, lotes, etc.). Contacta al administrador.';
    }
    
    res.status(500).json({ 
      message: errorMessage, 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  } finally {
    client.release();
  }
};