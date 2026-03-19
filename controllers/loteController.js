const { Pool } = require('pg');

// Conexión nativa a la base de datos de Cygnus
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const getLotesByProject = async (req, res) => {
  try {
    const proyectoId = req.params.projectId || req.query.projectId;

    if (!proyectoId || proyectoId === 'null' || proyectoId === 'undefined' || isNaN(Number(proyectoId))) {
      return res.status(200).json([]); 
    }

    const lotesQuery = `
      SELECT *, 'lote' as source_type 
      FROM lotes 
      WHERE proyecto_id = $1 
      ORDER BY id ASC
    `;
    const { rows: lotes } = await pool.query(lotesQuery, [proyectoId]);

    const hotspotsQuery = `
      SELECT *, 'poi' as source_type 
      FROM hotspots 
      WHERE proyecto_id = $1
    `;
    const { rows: hotspots } = await pool.query(hotspotsQuery, [proyectoId]);

    const todos = [...lotes, ...hotspots].map(item => {
        return {
            ...item,
            poligono_json: typeof (item.poligono_json || item.coordenadas_json) === 'string' 
                ? JSON.parse(item.poligono_json || item.coordenadas_json) 
                : (item.poligono_json || item.coordenadas_json),
            tipo: item.tipo || (item.source_type === 'poi' ? 'poi' : (item.numero_lote === 'Camino' ? 'camino' : 'lote'))
        };
    });

    res.json(todos);

  } catch (error) {
    console.error('❌ Error al obtener datos:', error);
    res.status(200).json([]); 
  }
};

const getAllLotes = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM lotes ORDER BY id ASC');
    res.json(rows);
  } catch (error) {
    console.error('❌ Error en getAllLotes:', error);
    res.status(500).json({ error: error.message });
  }
};

const createLote = async (req, res) => {
  try {
    const { 
        numero, numero_lote, 
        estado, estado_id, 
        precio, 
        project_id, proyecto_id,
        poligono_json,
        superficie, 
        tipo, 
        titulo, descripcion, color 
    } = req.body;

    const idProyecto = project_id || proyecto_id;
    const numFinal = numero || numero_lote || 'S/N';
    const estFinal = estado || estado_id || 1;
    const preFinal = precio || 0;
    const supFinal = superficie || '';
    const tipoFinal = tipo || 'lote';
    const usuarioId = req.session.user ? req.session.user.id : null;

    if (!idProyecto) return res.status(400).json({ error: "Falta ID del proyecto" });

    if (tipoFinal === 'poi') {
        const text = `
            INSERT INTO hotspots (proyecto_id, titulo, descripcion, coordenadas_json)
            VALUES ($1, $2, $3, $4) RETURNING id
        `;
        const values = [idProyecto, titulo || numFinal, descripcion || '', JSON.stringify(poligono_json)];
        const { rows } = await pool.query(text, values);
        
        // Registrar actividad
        if (usuarioId) {
            await pool.query(
                `INSERT INTO registro_actividad (usuario_id, accion, entidad_afectada, entidad_id) VALUES ($1, $2, $3, $4)`,
                [usuarioId, 'Crear POI', 'hotspots', rows[0].id]
            );
        }

        return res.status(201).json({ message: 'POI creado', id: rows[0].id });
    }
    
    // Creación de Lote / Camino
    const text = `
      INSERT INTO lotes (proyecto_id, numero_lote, estado_id, precio, superficie, poligono_json, tipo, color_hex) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *
    `;
    const values = [
        idProyecto, numFinal, estFinal, preFinal, supFinal, 
        JSON.stringify(poligono_json), tipoFinal, color 
    ];
    
    const { rows } = await pool.query(text, values);
    const nuevoLote = rows[0];

    // Registrar actividad de creación de lote
    if (usuarioId) {
        await pool.query(
            `INSERT INTO registro_actividad (usuario_id, accion, entidad_afectada, entidad_id) VALUES ($1, $2, $3, $4)`,
            [usuarioId, 'Crear Lote', 'lotes', nuevoLote.id]
        );
    }

    res.status(201).json(nuevoLote);

  } catch (error) {
    console.error('❌ Error al guardar:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateLote = async (req, res) => {
  try {
    const { id } = req.params;
    const { numero, numero_lote, estado, estado_id, precio, superficie } = req.body;
    
    const numFinal = numero || numero_lote;
    const estFinal = estado || estado_id;
    const usuarioId = req.session.user ? req.session.user.id : null;

    // 1. Obtener datos actuales del lote (Para el historial de precios)
    const loteAnteriorResult = await pool.query('SELECT precio FROM lotes WHERE id = $1', [id]);
    if (loteAnteriorResult.rows.length === 0) {
        return res.status(404).json({ message: 'Lote no encontrado' });
    }
    const precioAnterior = loteAnteriorResult.rows[0].precio;

    // 2. Actualizar el lote
    const text = `
        UPDATE lotes 
        SET numero_lote = $1, estado_id = $2, precio = $3, superficie = $4
        WHERE id = $5 
        RETURNING *
    `;
    const values = [numFinal, estFinal, precio, superficie, id];
    const { rows } = await pool.query(text, values);
    const loteActualizado = rows[0];
    
    // 3. REGISTRO DE HISTORIAL DE PRECIO (Si el precio cambió)
    if (precio !== undefined && Number(precioAnterior) !== Number(precio)) {
        await pool.query(
            `INSERT INTO historial_precios (lote_id, precio_anterior, precio_nuevo, modificado_por, motivo) 
             VALUES ($1, $2, $3, $4, $5)`,
            [id, precioAnterior, precio, usuarioId, 'Actualización desde el panel 360']
        );
    }

    res.json(loteActualizado);

  } catch (error) {
    console.error('❌ Error al actualizar:', error);
    res.status(500).json({ error: error.message });
  }
};

const deleteLote = async (req, res) => {
  try {
    const { id } = req.params;
    const usuarioId = req.session.user ? req.session.user.id : null;
    
    // Intentar borrar lote
    const resultLotes = await pool.query('DELETE FROM lotes WHERE id = $1', [id]);
    
    if (resultLotes.rowCount > 0) {
        if (usuarioId) {
            await pool.query(
                `INSERT INTO registro_actividad (usuario_id, accion, entidad_afectada, entidad_id) VALUES ($1, $2, $3, $4)`,
                [usuarioId, 'Eliminar Lote', 'lotes', id]
            );
        }
        return res.sendStatus(204); 
    }

    // Si no era lote, intentar borrar hotspot (POI)
    const resultHotspots = await pool.query('DELETE FROM hotspots WHERE id = $1', [id]);

    if (resultHotspots.rowCount > 0) {
        if (usuarioId) {
            await pool.query(
                `INSERT INTO registro_actividad (usuario_id, accion, entidad_afectada, entidad_id) VALUES ($1, $2, $3, $4)`,
                [usuarioId, 'Eliminar POI', 'hotspots', id]
            );
        }
        return res.sendStatus(204); 
    }

    res.status(404).json({ message: 'Elemento no encontrado para eliminar' });

  } catch (error) {
    console.error('❌ Error al eliminar:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getLotesByProject,
  getAllLotes,
  createLote,
  updateLote,
  deleteLote
};