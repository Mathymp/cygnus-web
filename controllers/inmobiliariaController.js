const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const isAdmin = (req) => req.session.user && req.session.user.role === 'admin';

// ==========================================
//  HELPER: INSERTAR AUDITORÍA
// ==========================================
async function auditLog(client, { tabla, entidadId, accion, descripcion, req }) {
    const userId = req.session.user ? req.session.user.id : null;
    const userName = req.session.user ? req.session.user.name : 'Sistema';
    try {
        await client.query(
            `INSERT INTO im_auditoria (tabla_afectada, entidad_id, accion, descripcion, usuario_id, usuario_nombre)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tabla, entidadId || null, accion, descripcion, userId, userName]
        );
    } catch (_) { /* No bloquear por fallo de auditoría */ }
}

// ==========================================
//  PROYECTOS
// ==========================================

exports.getProyectos = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM im_proyectos ORDER BY creado_at DESC`
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createProyecto = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores pueden crear proyectos.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { nombre, estado, total_parcelas, numero_rol_1, numero_rol_2, numero_matriz } = req.body;
        if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio.' });

        const totalParcelas = parseInt(total_parcelas, 10) || 0;

        const proyectoRes = await client.query(
            `INSERT INTO im_proyectos (nombre, estado, total_parcelas, numero_rol_1, numero_rol_2, numero_matriz)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre, estado || 'activo', totalParcelas, numero_rol_1 || null, numero_rol_2 || null, numero_matriz || null]
        );
        const proyecto = proyectoRes.rows[0];

        // Generar parcelas automáticamente si se especificó total
        if (totalParcelas > 0) {
            for (let i = 1; i <= totalParcelas; i++) {
                await client.query(
                    `INSERT INTO im_parcelas (proyecto_id, numero_parcela) VALUES ($1, $2)`,
                    [proyecto.id, i]
                );
            }
        }

        await auditLog(client, {
            tabla: 'im_proyectos', entidadId: proyecto.id,
            accion: 'CREAR', descripcion: `Proyecto "${nombre}" creado con ${totalParcelas} parcelas.`, req
        });

        await client.query('COMMIT');
        res.status(201).json({ message: 'Proyecto creado.', proyecto });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.updateProyecto = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores pueden editar proyectos.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { nombre, estado, numero_rol_1, numero_rol_2, numero_matriz } = req.body;

        const result = await client.query(
            `UPDATE im_proyectos SET nombre=$1, estado=$2, numero_rol_1=$3, numero_rol_2=$4, numero_matriz=$5
             WHERE id=$6 RETURNING *`,
            [nombre, estado, numero_rol_1 || null, numero_rol_2 || null, numero_matriz || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Proyecto no encontrado.' });

        await auditLog(client, {
            tabla: 'im_proyectos', entidadId: id,
            accion: 'ACTUALIZAR', descripcion: `Proyecto "${nombre}" actualizado.`, req
        });

        await client.query('COMMIT');
        res.json({ message: 'Proyecto actualizado.', proyecto: result.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.deleteProyecto = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores pueden eliminar proyectos.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const result = await client.query(`DELETE FROM im_proyectos WHERE id=$1 RETURNING nombre`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Proyecto no encontrado.' });

        await auditLog(client, {
            tabla: 'im_proyectos', entidadId: id,
            accion: 'ELIMINAR', descripcion: `Proyecto "${result.rows[0].nombre}" eliminado.`, req
        });
        await client.query('COMMIT');
        res.sendStatus(204);
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23503') return res.status(409).json({ message: 'No se puede eliminar: el proyecto tiene datos relacionados.' });
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

// ==========================================
//  PARCELAS
// ==========================================

exports.getParcelas = async (req, res) => {
    try {
        const { proyectoId } = req.params;
        const result = await pool.query(
            `SELECT p.*, 
                (SELECT precio FROM im_historial_precios WHERE parcela_id = p.id ORDER BY fecha_registro DESC LIMIT 1) as ultimo_precio,
                (SELECT c.nombre_completo FROM im_ventas_lotes v JOIN im_clientes c ON v.cliente_id = c.id WHERE v.parcela_id = p.id ORDER BY v.creado_at DESC LIMIT 1) as cliente_nombre
             FROM im_parcelas p
             WHERE p.proyecto_id = $1
             ORDER BY p.numero_parcela ASC`,
            [proyectoId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getParcelaById = async (req, res) => {
    try {
        const { id } = req.params;
        const [parcelaRes, historialRes, ventaRes] = await Promise.all([
            pool.query(
                `SELECT p.*, pr.nombre as proyecto_nombre, pr.numero_rol_1, pr.numero_rol_2, pr.numero_matriz
                 FROM im_parcelas p
                 JOIN im_proyectos pr ON p.proyecto_id = pr.id
                 WHERE p.id = $1`, [id]
            ),
            pool.query(
                `SELECT precio, fecha_registro FROM im_historial_precios
                 WHERE parcela_id = $1 ORDER BY fecha_registro ASC`, [id]
            ),
            pool.query(
                `SELECT v.*, c.nombre_completo, c.rut, c.estado_civil, c.nombre_conyugue, c.rut_conyugue, c.direccion, c.id as cliente_id
                 FROM im_ventas_lotes v JOIN im_clientes c ON v.cliente_id = c.id
                 WHERE v.parcela_id = $1 ORDER BY v.creado_at DESC LIMIT 1`, [id]
            )
        ]);

        if (parcelaRes.rows.length === 0) return res.status(404).json({ message: 'Parcela no encontrada.' });

        res.json({
            parcela: parcelaRes.rows[0],
            historial_precios: historialRes.rows,
            venta: ventaRes.rows[0] || null
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createParcela = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores pueden crear parcelas.' });
    try {
        const { proyecto_id, numero_parcela, numero_rol_parcela, metraje, precio_actual } = req.body;
        const result = await pool.query(
            `INSERT INTO im_parcelas (proyecto_id, numero_parcela, numero_rol_parcela, metraje, precio_actual)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [proyecto_id, numero_parcela, numero_rol_parcela || null, metraje || null, precio_actual || null]
        );

        if (precio_actual) {
            await pool.query(
                `INSERT INTO im_historial_precios (parcela_id, precio) VALUES ($1, $2)`,
                [result.rows[0].id, precio_actual]
            );
        }

        res.status(201).json(result.rows[0]);
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: 'Ya existe una parcela con ese número en el proyecto.' });
        res.status(500).json({ error: e.message });
    }
};

exports.createParcelasBulk = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { proyecto_id, desde, hasta } = req.body;
        const desdeN = parseInt(desde, 10);
        const hastaN = parseInt(hasta, 10);

        if (isNaN(desdeN) || isNaN(hastaN) || desdeN > hastaN)
            return res.status(400).json({ message: 'Rango inválido.' });

        const inserted = [];
        for (let i = desdeN; i <= hastaN; i++) {
            const r = await client.query(
                `INSERT INTO im_parcelas (proyecto_id, numero_parcela) VALUES ($1, $2)
                 ON CONFLICT (proyecto_id, numero_parcela) DO NOTHING RETURNING id`,
                [proyecto_id, i]
            );
            if (r.rows.length > 0) inserted.push(i);
        }

        // Actualizar total_parcelas en proyecto
        await client.query(
            `UPDATE im_proyectos SET total_parcelas = (SELECT COUNT(*) FROM im_parcelas WHERE proyecto_id = $1) WHERE id = $1`,
            [proyecto_id]
        );

        await auditLog(client, {
            tabla: 'im_parcelas', entidadId: proyecto_id,
            accion: 'CREAR_BULK', descripcion: `Se crearon parcelas ${desdeN}–${hastaN}.`, req
        });

        await client.query('COMMIT');
        res.status(201).json({ message: `${inserted.length} parcelas creadas.`, insertadas: inserted });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.updateParcela = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { numero_rol_parcela, metraje, precio_actual, estado_venta } = req.body;

        const current = await client.query(
            `SELECT precio_actual FROM im_parcelas WHERE id = $1`, [id]
        );
        if (current.rows.length === 0) return res.status(404).json({ message: 'Parcela no encontrada.' });

        const oldPrice = current.rows[0].precio_actual;
        const newPrice = precio_actual != null ? parseFloat(precio_actual) : oldPrice;

        const result = await client.query(
            `UPDATE im_parcelas SET numero_rol_parcela=$1, metraje=$2, precio_actual=$3, estado_venta=$4
             WHERE id=$5 RETURNING *`,
            [numero_rol_parcela || null, metraje || null, newPrice, estado_venta || 'disponible', id]
        );

        // Registrar historial de precio si cambió
        if (newPrice && parseFloat(oldPrice) !== newPrice) {
            await client.query(
                `INSERT INTO im_historial_precios (parcela_id, precio) VALUES ($1, $2)`,
                [id, newPrice]
            );
        }

        await auditLog(client, {
            tabla: 'im_parcelas', entidadId: id,
            accion: 'ACTUALIZAR',
            descripcion: `Parcela actualizada. Estado: ${estado_venta}. Precio: ${newPrice ? '$' + Number(newPrice).toLocaleString('es-CL') : 'sin precio'}.`,
            req
        });

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.deleteParcela = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        const { id } = req.params;
        const result = await pool.query(`DELETE FROM im_parcelas WHERE id=$1 RETURNING id`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Parcela no encontrada.' });
        res.sendStatus(204);
    } catch (e) {
        if (e.code === '23503') return res.status(409).json({ message: 'La parcela tiene datos relacionados (ventas, documentos).' });
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
//  CLIENTES INMOBILIARIA
// ==========================================

exports.getClientes = async (req, res) => {
    try {
        const { q } = req.query;
        let query = `SELECT * FROM im_clientes`;
        const params = [];
        if (q) {
            query += ` WHERE nombre_completo ILIKE $1 OR rut ILIKE $1`;
            params.push(`%${q}%`);
        }
        query += ` ORDER BY nombre_completo ASC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.buscarClientePorRut = async (req, res) => {
    try {
        const { rut } = req.query;
        if (!rut) return res.status(400).json({ message: 'RUT requerido.' });
        const result = await pool.query(
            `SELECT * FROM im_clientes WHERE rut = $1 LIMIT 1`, [rut]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado.' });
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createCliente = async (req, res) => {
    try {
        const { nombre_completo, rut, direccion, estado_civil, nombre_conyugue, rut_conyugue } = req.body;
        if (!nombre_completo || !rut) return res.status(400).json({ message: 'Nombre y RUT son obligatorios.' });

        const result = await pool.query(
            `INSERT INTO im_clientes (nombre_completo, rut, direccion, estado_civil, nombre_conyugue, rut_conyugue)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nombre_completo, rut, direccion || null, estado_civil || 'Soltero/a', nombre_conyugue || null, rut_conyugue || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: 'Ya existe un cliente con ese RUT.' });
        res.status(500).json({ error: e.message });
    }
};

exports.updateCliente = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre_completo, rut, direccion, estado_civil, nombre_conyugue, rut_conyugue } = req.body;
        const result = await pool.query(
            `UPDATE im_clientes SET nombre_completo=$1, rut=$2, direccion=$3, estado_civil=$4,
             nombre_conyugue=$5, rut_conyugue=$6 WHERE id=$7 RETURNING *`,
            [nombre_completo, rut, direccion || null, estado_civil || 'Soltero/a', nombre_conyugue || null, rut_conyugue || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado.' });
        res.json(result.rows[0]);
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: 'Ya existe un cliente con ese RUT.' });
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
//  VENTAS DE LOTES
// ==========================================

exports.getVentas = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.*, c.nombre_completo, c.rut,
                    p.numero_parcela, p.proyecto_id,
                    pr.nombre as proyecto_nombre
             FROM im_ventas_lotes v
             JOIN im_clientes c ON v.cliente_id = c.id
             JOIN im_parcelas p ON v.parcela_id = p.id
             JOIN im_proyectos pr ON p.proyecto_id = pr.id
             ORDER BY v.creado_at DESC`
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { parcela_id, cliente_id, firmo_promesa, firmo_compraventa, forma_pago, fecha_venta } = req.body;
        if (!parcela_id || !cliente_id) return res.status(400).json({ message: 'Parcela y cliente son obligatorios.' });

        // Eliminar venta previa si existe (reasignación)
        await client.query(`DELETE FROM im_ventas_lotes WHERE parcela_id = $1`, [parcela_id]);

        const result = await client.query(
            `INSERT INTO im_ventas_lotes (parcela_id, cliente_id, firmo_promesa, firmo_compraventa, forma_pago, fecha_venta)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [parcela_id, cliente_id, firmo_promesa || false, firmo_compraventa || false, forma_pago || null, fecha_venta || new Date().toISOString().split('T')[0]]
        );

        // Actualizar estado de la parcela
        const nuevoEstado = firmo_compraventa ? 'vendido' : 'reservado';
        await client.query(`UPDATE im_parcelas SET estado_venta=$1 WHERE id=$2`, [nuevoEstado, parcela_id]);

        await auditLog(client, {
            tabla: 'im_ventas_lotes', entidadId: result.rows[0].id,
            accion: 'CREAR',
            descripcion: `Venta registrada. Parcela ID: ${parcela_id}. Estado: ${nuevoEstado}. Forma de pago: ${forma_pago || 'no especificada'}.`,
            req
        });

        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.deleteVenta = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        const ventaRes = await client.query(`SELECT parcela_id FROM im_ventas_lotes WHERE id=$1`, [id]);
        if (ventaRes.rows.length === 0) return res.status(404).json({ message: 'Venta no encontrada.' });

        await client.query(`DELETE FROM im_ventas_lotes WHERE id=$1`, [id]);
        await client.query(`UPDATE im_parcelas SET estado_venta='disponible' WHERE id=$1`, [ventaRes.rows[0].parcela_id]);

        await auditLog(client, {
            tabla: 'im_ventas_lotes', entidadId: id,
            accion: 'ELIMINAR', descripcion: 'Venta eliminada. Parcela devuelta a disponible.', req
        });

        await client.query('COMMIT');
        res.sendStatus(204);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

// ==========================================
//  ACCESOS AL MÓDULO (CONTROL DE USUARIOS)
// ==========================================

exports.getAccesos = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, u.role,
                   a.puede_crear,
                   CASE WHEN a.user_id IS NOT NULL THEN true ELSE false END as tiene_acceso
            FROM users u
            LEFT JOIN im_accesos a ON a.user_id = u.id
            WHERE u.role <> 'superadmin'
            ORDER BY tiene_acceso DESC, u.name ASC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.setAcceso = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        const { user_id, puede_crear } = req.body;
        if (!user_id) return res.status(400).json({ message: 'user_id requerido.' });
        const result = await pool.query(
            `INSERT INTO im_accesos (user_id, puede_crear)
             VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET puede_crear = $2
             RETURNING *`,
            [user_id, puede_crear === true || puede_crear === 'true']
        );
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteAcceso = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        await pool.query('DELETE FROM im_accesos WHERE user_id = $1', [req.params.userId]);
        res.sendStatus(204);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ==========================================
//  AUDITORÍA
// ==========================================

exports.getAuditoria = async (req, res) => {
    try {
        const { entidad_id, tabla } = req.query;
        let query = `SELECT * FROM im_auditoria WHERE 1=1`;
        const params = [];

        if (entidad_id) {
            params.push(entidad_id);
            query += ` AND entidad_id = $${params.length}`;
        }
        if (tabla) {
            params.push(tabla);
            query += ` AND tabla_afectada = $${params.length}`;
        }

        query += ` ORDER BY fecha DESC LIMIT 50`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
