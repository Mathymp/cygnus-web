const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const isAdmin = (req) => req.session.user && req.session.user.role === 'admin';

// Autorizado = admin O tiene acceso al módulo inmobiliario
async function isAuthorized(req) {
    if (isAdmin(req)) return true;
    if (!req.session || !req.session.user) return false;
    try {
        const { rows } = await pool.query(
            `SELECT id FROM im_accesos WHERE user_id=$1`,
            [req.session.user.id]
        );
        return rows.length > 0;
    } catch { return false; }
}

async function auditLog(client, { tabla, entidadId, accion, descripcion, req }) {
    const userId   = req.session.user ? req.session.user.id   : null;
    const userName = req.session.user ? req.session.user.name : 'Sistema';
    try {
        await client.query(
            `INSERT INTO im_auditoria (tabla_afectada, entidad_id, accion, descripcion, usuario_id, usuario_nombre)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tabla, entidadId || null, accion, descripcion, userId, userName]
        );
    } catch (_) {}
}

// ==========================================
//  PROYECTOS
// ==========================================

exports.getProyectos = async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM im_proyectos ORDER BY creado_at DESC`);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createProyecto = async (req, res) => {
    if (!await isAuthorized(req)) return res.status(403).json({ message: 'No tienes acceso al módulo de gestión de campos.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { nombre, estado, total_parcelas, numero_rol_1, numero_rol_2, numero_matriz, tipo_proyecto } = req.body;
        if (!nombre || !nombre.trim()) return res.status(400).json({ message: 'El nombre es obligatorio.' });
        const totalParcelas = parseInt(total_parcelas, 10) || 0;
        const proyectoRes = await client.query(
            `INSERT INTO im_proyectos (nombre, estado, total_parcelas, numero_rol_1, numero_rol_2, numero_matriz, tipo_proyecto)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [nombre.trim(), estado || 'activo', totalParcelas,
             numero_rol_1 || null, numero_rol_2 || null, numero_matriz || null,
             tipo_proyecto || 'en_verde']
        );
        const proyecto = proyectoRes.rows[0];
        if (totalParcelas > 0) {
            for (let i = 1; i <= totalParcelas; i++) {
                await client.query(
                    `INSERT INTO im_parcelas (proyecto_id, numero_parcela) VALUES ($1, $2)`, [proyecto.id, i]
                );
            }
        }
        await auditLog(client, { tabla: 'im_proyectos', entidadId: proyecto.id,
            accion: 'CREAR', descripcion: `Proyecto "${nombre}" creado con ${totalParcelas} parcelas.`, req });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Proyecto creado.', proyecto });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.updateProyecto = async (req, res) => {
    if (!await isAuthorized(req)) return res.status(403).json({ message: 'No tienes acceso al módulo de gestión de campos.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { nombre, estado, numero_rol_1, numero_rol_2, numero_matriz, tipo_proyecto } = req.body;
        const result = await client.query(
            `UPDATE im_proyectos SET nombre=$1, estado=$2, numero_rol_1=$3, numero_rol_2=$4,
             numero_matriz=$5, tipo_proyecto=$6 WHERE id=$7 RETURNING *`,
            [nombre, estado, numero_rol_1 || null, numero_rol_2 || null, numero_matriz || null,
             tipo_proyecto || 'en_verde', id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Proyecto no encontrado.' });
        await auditLog(client, { tabla: 'im_proyectos', entidadId: id,
            accion: 'ACTUALIZAR', descripcion: `Proyecto "${nombre}" actualizado.`, req });
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
        await auditLog(client, { tabla: 'im_proyectos', entidadId: id,
            accion: 'ELIMINAR', descripcion: `Proyecto "${result.rows[0].nombre}" eliminado.`, req });
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
             FROM im_parcelas p WHERE p.proyecto_id = $1
             ORDER BY LENGTH(p.numero_parcela::TEXT) ASC, p.numero_parcela ASC`,
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
                 FROM im_parcelas p JOIN im_proyectos pr ON p.proyecto_id = pr.id WHERE p.id = $1`, [id]
            ),
            pool.query(`SELECT precio, fecha_registro FROM im_historial_precios WHERE parcela_id=$1 ORDER BY fecha_registro ASC`, [id]),
            pool.query(
                `SELECT v.*, c.nombre_completo, c.rut, c.email, c.telefono, c.estado_civil,
                         c.regimen_matrimonial, c.nombre_conyugue, c.rut_conyugue,
                         c.email_conyugue, c.telefono_conyugue,
                         c.direccion, c.id as cliente_id, v.agente_id, v.agente_nombre
                 FROM im_ventas_lotes v JOIN im_clientes c ON v.cliente_id = c.id
                 WHERE v.parcela_id=$1 AND v.estado='activa' ORDER BY v.creado_at DESC LIMIT 1`, [id]
            )
        ]);
        if (parcelaRes.rows.length === 0) return res.status(404).json({ message: 'Parcela no encontrada.' });

        const venta = ventaRes.rows[0] || null;
        let cuotas = [];
        if (venta) {
            const cuotasRes = await pool.query(
                `SELECT * FROM im_cuotas WHERE venta_id=$1 ORDER BY numero_cuota ASC`, [venta.id]
            );
            cuotas = cuotasRes.rows;
        }

        // Historial de todas las ventas anteriores (resciliadas / liberadas)
        const historialVentasRes = await pool.query(
            `SELECT v.id, v.estado, v.tipo_pago, v.precio_acordado, v.fecha_venta,
                    v.firmo_promesa, v.firmo_compraventa, v.agente_nombre, v.condiciones_compra,
                    v.creado_at,
                    c.nombre_completo, c.rut,
                    r.id as resc_id, r.fecha as resc_fecha, r.motivo as resc_motivo,
                    r.notas as resc_notas, r.creado_por_nombre as resc_agente
             FROM im_ventas_lotes v
             JOIN im_clientes c ON v.cliente_id = c.id
             LEFT JOIN im_resciliaciones r ON r.venta_id = v.id
             WHERE v.parcela_id=$1 AND v.estado <> 'activa'
             ORDER BY v.creado_at DESC`, [id]
        );

        res.json({
            parcela: parcelaRes.rows[0],
            historial_precios: historialRes.rows,
            venta,
            cuotas,
            historial_ventas: historialVentasRes.rows
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createParcela = async (req, res) => {
    if (!await isAuthorized(req)) return res.status(403).json({ message: 'No tienes acceso al módulo de gestión de campos.' });
    try {
        const { proyecto_id, numero_parcela, numero_rol_parcela, metraje, precio_actual } = req.body;
        const numStr = String(numero_parcela || '').trim().toUpperCase();
        if (!numStr) return res.status(400).json({ message: 'El número de parcela es obligatorio.' });

        // Verificar duplicado dentro del mismo proyecto (case-insensitive)
        const dup = await pool.query(
            `SELECT id FROM im_parcelas WHERE proyecto_id=$1 AND UPPER(TRIM(numero_parcela::TEXT))=$2`,
            [proyecto_id, numStr]
        );
        if (dup.rows.length > 0)
            return res.status(409).json({ message: `Ya existe una parcela con el número "${numStr}" en este proyecto.` });

        const result = await pool.query(
            `INSERT INTO im_parcelas (proyecto_id, numero_parcela, numero_rol_parcela, metraje, precio_actual)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [proyecto_id, numStr, numero_rol_parcela || null, metraje || null, precio_actual || null]
        );
        if (precio_actual) {
            await pool.query(`INSERT INTO im_historial_precios (parcela_id, precio) VALUES ($1, $2)`,
                [result.rows[0].id, precio_actual]);
        }
        // Actualizar total_parcelas del proyecto
        await pool.query(
            `UPDATE im_proyectos SET total_parcelas=(SELECT COUNT(*) FROM im_parcelas WHERE proyecto_id=$1) WHERE id=$1`,
            [proyecto_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: 'Ya existe una parcela con ese número en el proyecto.' });
        res.status(500).json({ error: e.message });
    }
};

exports.createParcelasBulk = async (req, res) => {
    if (!await isAuthorized(req)) return res.status(403).json({ message: 'No tienes acceso al módulo de gestión de campos.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { proyecto_id, desde, hasta } = req.body;
        const desdeN = parseInt(desde, 10), hastaN = parseInt(hasta, 10);
        if (isNaN(desdeN) || isNaN(hastaN) || desdeN > hastaN)
            return res.status(400).json({ message: 'Rango inválido.' });
        const inserted = [];
        for (let i = desdeN; i <= hastaN; i++) {
            const r = await client.query(
                `INSERT INTO im_parcelas (proyecto_id, numero_parcela) VALUES ($1, $2)
                 ON CONFLICT (proyecto_id, numero_parcela) DO NOTHING RETURNING id`, [proyecto_id, i]
            );
            if (r.rows.length > 0) inserted.push(i);
        }
        await client.query(
            `UPDATE im_proyectos SET total_parcelas=(SELECT COUNT(*) FROM im_parcelas WHERE proyecto_id=$1) WHERE id=$1`,
            [proyecto_id]
        );
        await auditLog(client, { tabla: 'im_parcelas', entidadId: proyecto_id,
            accion: 'CREAR_BULK', descripcion: `Parcelas ${desdeN}–${hastaN} creadas.`, req });
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
        const current = await client.query(`SELECT precio_actual FROM im_parcelas WHERE id=$1`, [id]);
        if (current.rows.length === 0) return res.status(404).json({ message: 'Parcela no encontrada.' });
        const oldPrice = current.rows[0].precio_actual;
        const newPrice = precio_actual != null && precio_actual !== '' ? parseFloat(String(precio_actual).replace(/\./g,'')) : oldPrice;
        const result = await client.query(
            `UPDATE im_parcelas SET numero_rol_parcela=$1, metraje=$2, precio_actual=$3, estado_venta=$4 WHERE id=$5 RETURNING *`,
            [numero_rol_parcela || null, metraje || null, newPrice || null, estado_venta || 'disponible', id]
        );
        if (newPrice && parseFloat(oldPrice) !== newPrice) {
            await client.query(`INSERT INTO im_historial_precios (parcela_id, precio) VALUES ($1, $2)`, [id, newPrice]);
        }
        await auditLog(client, { tabla: 'im_parcelas', entidadId: id,
            accion: 'ACTUALIZAR',
            descripcion: `Estado: ${estado_venta}. Precio: ${newPrice ? '$' + Number(newPrice).toLocaleString('es-CL') : 'sin precio'}.`, req });
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
        if (e.code === '23503') return res.status(409).json({ message: 'La parcela tiene datos relacionados.' });
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
//  CLIENTES INMOBILIARIA
// ==========================================

exports.getClientes = async (req, res) => {
    try {
        const { q, proyecto_id } = req.query;
        let query = `
            SELECT c.*,
                (SELECT COUNT(*) FROM im_ventas_lotes v WHERE v.cliente_id = c.id) as total_compras
            FROM im_clientes c WHERE 1=1`;
        const params = [];
        if (q) {
            params.push(`%${q}%`);
            query += ` AND (c.nombre_completo ILIKE $${params.length} OR c.rut ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.telefono ILIKE $${params.length})`;
        }
        if (proyecto_id) {
            params.push(proyecto_id);
            query += ` AND EXISTS (
                SELECT 1 FROM im_ventas_lotes v2
                JOIN im_parcelas pa2 ON v2.parcela_id = pa2.id
                WHERE v2.cliente_id = c.id AND pa2.proyecto_id = $${params.length}
            )`;
        }
        query += ` ORDER BY c.nombre_completo ASC`;
        const clientes = await pool.query(query, params);

        // For each client, get all their parcelas/ventas
        const result = await Promise.all(clientes.rows.map(async (c) => {
            const ventas = await pool.query(
                `SELECT v.id as venta_id, v.tipo_pago, v.precio_acordado, v.fecha_venta,
                        v.firmo_promesa, v.firmo_compraventa, v.estado_cuotas,
                        pa.id as parcela_id, pa.numero_parcela, pa.estado_venta,
                        pr.id as proyecto_id, pr.nombre as proyecto_nombre
                 FROM im_ventas_lotes v
                 JOIN im_parcelas pa ON v.parcela_id = pa.id
                 JOIN im_proyectos pr ON pa.proyecto_id = pr.id
                 WHERE v.cliente_id=$1 ORDER BY v.creado_at DESC`, [c.id]
            );
            return { ...c, ventas: ventas.rows };
        }));

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.buscarClientePorRut = async (req, res) => {
    try {
        const { rut, q } = req.query;
        const term = (rut || q || '').trim();
        if (!term) return res.status(400).json({ message: 'Ingresa un RUT o nombre para buscar.' });

        // Si parece RUT (contiene guion o solo dígitos+K), buscar por RUT exacto primero
        const esRut = /[0-9kK][-]/.test(term) || /^\d{7,9}[kK\d]$/.test(term.replace(/\./g,''));
        if (esRut) {
            const r = await pool.query(`SELECT * FROM im_clientes WHERE rut = $1 LIMIT 1`, [term]);
            if (r.rows.length > 0) return res.json(r.rows[0]);
        }

        // Búsqueda flexible por nombre o RUT parcial (devuelve hasta 8 resultados)
        const result = await pool.query(
            `SELECT * FROM im_clientes WHERE nombre_completo ILIKE $1 OR rut ILIKE $1 ORDER BY nombre_completo ASC LIMIT 8`,
            [`%${term}%`]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'No se encontró ningún cliente con ese nombre o RUT.' });
        if (result.rows.length === 1) return res.json(result.rows[0]);
        res.json({ multiple: true, clientes: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createCliente = async (req, res) => {
    try {
        const { nombre_completo, rut, direccion, estado_civil, regimen_matrimonial,
                nombre_conyugue, rut_conyugue, email_conyugue, telefono_conyugue,
                email, telefono } = req.body;
        if (!nombre_completo || !rut) return res.status(400).json({ message: 'Nombre y RUT son obligatorios.' });
        const result = await pool.query(
            `INSERT INTO im_clientes (nombre_completo, rut, direccion, estado_civil, regimen_matrimonial,
             nombre_conyugue, rut_conyugue, email_conyugue, telefono_conyugue, email, telefono)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [nombre_completo, rut, direccion || null, estado_civil || 'Soltero/a',
             regimen_matrimonial || null,
             nombre_conyugue || null, rut_conyugue || null,
             email_conyugue || null, telefono_conyugue || null,
             email || null, telefono || null]
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
        const { nombre_completo, rut, direccion, estado_civil, regimen_matrimonial,
                nombre_conyugue, rut_conyugue, email_conyugue, telefono_conyugue,
                email, telefono } = req.body;
        const result = await pool.query(
            `UPDATE im_clientes SET nombre_completo=$1, rut=$2, direccion=$3, estado_civil=$4,
             regimen_matrimonial=$5, nombre_conyugue=$6, rut_conyugue=$7,
             email_conyugue=$8, telefono_conyugue=$9, email=$10, telefono=$11 WHERE id=$12 RETURNING *`,
            [nombre_completo, rut, direccion || null, estado_civil || 'Soltero/a',
             regimen_matrimonial || null,
             nombre_conyugue || null, rut_conyugue || null,
             email_conyugue || null, telefono_conyugue || null,
             email || null, telefono || null, id]
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
        const {
            parcela_id, cliente_id, firmo_promesa, firmo_compraventa,
            forma_pago, fecha_venta, precio_lista, precio_acordado, notas,
            tipo_pago, monto_pie, numero_credito, numero_cuotas, monto_cuota,
            condiciones_compra, fechas_cuotas,
            agente_id, agente_nombre
        } = req.body;
        if (!parcela_id || !cliente_id) return res.status(400).json({ message: 'Parcela y cliente son obligatorios.' });

        const cleanNum = (v) => v && String(v).trim() ? parseFloat(String(v).replace(/\./g,'').replace(',','.')) : null;

        // Marcar ventas activas anteriores como 'liberada' (no eliminar — preservar historial)
        await client.query(
            `UPDATE im_ventas_lotes SET estado='liberada' WHERE parcela_id=$1 AND estado='activa'`,
            [parcela_id]
        );

        // Agente: usar el que viene en el body (admin puede elegir otro) o el usuario actual
        const agenteId   = agente_id   || req.session.user.id;
        const agenteNombre = agente_nombre || req.session.user.name;

        const result = await client.query(
            `INSERT INTO im_ventas_lotes (
                parcela_id, cliente_id, firmo_promesa, firmo_compraventa, forma_pago,
                fecha_venta, precio_lista, precio_acordado, notas,
                tipo_pago, monto_pie, numero_credito, numero_cuotas, monto_cuota, condiciones_compra,
                agente_id, agente_nombre, estado
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'activa') RETURNING *`,
            [
                parcela_id, cliente_id,
                firmo_promesa || false, firmo_compraventa || false,
                forma_pago || null,
                fecha_venta || new Date().toISOString().split('T')[0],
                cleanNum(precio_lista), cleanNum(precio_acordado),
                notas || null,
                tipo_pago || 'contado',
                cleanNum(monto_pie), numero_credito || null,
                parseInt(numero_cuotas,10) || 0,
                cleanNum(monto_cuota),
                condiciones_compra || null,
                agenteId, agenteNombre
            ]
        );
        const venta = result.rows[0];

        // Auto-generate cuotas schedule if provided
        if (tipo_pago === 'credito' && fechas_cuotas && Array.isArray(fechas_cuotas)) {
            for (let i = 0; i < fechas_cuotas.length; i++) {
                const fc = fechas_cuotas[i];
                await client.query(
                    `INSERT INTO im_cuotas (venta_id, numero_cuota, monto, fecha_vencimiento)
                     VALUES ($1, $2, $3, $4)`,
                    [venta.id, i + 1, cleanNum(fc.monto) || cleanNum(monto_cuota), fc.fecha || null]
                );
            }
        }

        const nuevoEstado = firmo_compraventa ? 'vendido' : 'reservado';
        await client.query(`UPDATE im_parcelas SET estado_venta=$1 WHERE id=$2`, [nuevoEstado, parcela_id]);

        await auditLog(client, { tabla: 'im_ventas_lotes', entidadId: venta.id,
            accion: 'CREAR',
            descripcion: `Venta ${tipo_pago||'contado'} por ${agenteNombre}. Estado: ${nuevoEstado}. Precio: ${precio_acordado ? '$' + Number(cleanNum(precio_acordado)).toLocaleString('es-CL') : 'sin precio'}.`, req });

        await client.query('COMMIT');
        res.status(201).json(venta);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.deleteVenta = async (req, res) => {
    if (!await isAuthorized(req)) return res.status(403).json({ message: 'No tienes acceso al módulo de gestión de campos.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const ventaRes = await client.query(`SELECT parcela_id FROM im_ventas_lotes WHERE id=$1`, [id]);
        if (ventaRes.rows.length === 0) return res.status(404).json({ message: 'Venta no encontrada.' });
        await client.query(`DELETE FROM im_ventas_lotes WHERE id=$1`, [id]);
        await client.query(`UPDATE im_parcelas SET estado_venta='disponible' WHERE id=$1`, [ventaRes.rows[0].parcela_id]);
        await auditLog(client, { tabla: 'im_ventas_lotes', entidadId: id,
            accion: 'ELIMINAR', descripcion: 'Venta eliminada. Parcela devuelta a disponible.', req });
        await client.query('COMMIT');
        res.sendStatus(204);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.resciliarVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { fecha, motivo, notas } = req.body;

        const ventaRes = await client.query(
            `SELECT parcela_id FROM im_ventas_lotes WHERE id=$1 AND estado='activa'`, [id]
        );
        if (ventaRes.rows.length === 0)
            return res.status(404).json({ message: 'Venta activa no encontrada.' });

        const parcela_id = ventaRes.rows[0].parcela_id;
        const agente = req.session.user ? req.session.user.name : 'Sistema';

        // Crear registro de resciliación
        const rescRes = await client.query(
            `INSERT INTO im_resciliaciones (venta_id, parcela_id, fecha, motivo, notas, creado_por_nombre)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [id, parcela_id, fecha || new Date().toISOString().split('T')[0], motivo || null, notas || null, agente]
        );

        // Marcar venta como resciliada
        await client.query(
            `UPDATE im_ventas_lotes SET estado='resciliada' WHERE id=$1`, [id]
        );

        // Liberar parcela
        await client.query(
            `UPDATE im_parcelas SET estado_venta='disponible' WHERE id=$1`, [parcela_id]
        );

        await auditLog(client, { tabla: 'im_ventas_lotes', entidadId: id,
            accion: 'RESCILIACION',
            descripcion: `Contrato resciliado por ${agente}. Motivo: ${motivo || 'no especificado'}. Parcela devuelta a disponible.`,
            req });

        await client.query('COMMIT');
        res.status(201).json(rescRes.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

// ==========================================
//  CUOTAS DE PAGO
// ==========================================

exports.getAllCuotas = async (req, res) => {
    if (!await isAuthorized(req)) return res.status(403).json({ message: 'Sin acceso.' });
    try {
        const { proyecto_id, estado } = req.query;
        let where = [];
        const params = [];
        if (proyecto_id) { params.push(proyecto_id); where.push(`pr.id = $${params.length}`); }
        if (estado === 'pendiente') where.push(`q.pagado = false`);
        else if (estado === 'pagada') where.push(`q.pagado = true`);
        const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const result = await pool.query(`
            SELECT
                q.id, q.numero_cuota, q.monto, q.fecha_vencimiento, q.fecha_pago,
                q.pagado, q.comprobante_url, q.storage_path, q.notas,
                v.id as venta_id, v.tipo_pago, v.precio_acordado,
                c.nombre_completo as cliente_nombre, c.telefono as cliente_telefono,
                c.email as cliente_email, c.rut as cliente_rut,
                pa.id as parcela_id, pa.numero_parcela,
                pr.id as proyecto_id, pr.nombre as proyecto_nombre
            FROM im_cuotas q
            JOIN im_ventas_lotes v ON q.venta_id = v.id
            JOIN im_clientes c ON v.cliente_id = c.id
            JOIN im_parcelas pa ON v.parcela_id = pa.id
            JOIN im_proyectos pr ON pa.proyecto_id = pr.id
            ${whereStr}
            ORDER BY q.pagado ASC, q.fecha_vencimiento ASC NULLS LAST
        `, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getCuotas = async (req, res) => {
    try {
        const { ventaId } = req.params;
        const result = await pool.query(
            `SELECT * FROM im_cuotas WHERE venta_id=$1 ORDER BY numero_cuota ASC`, [ventaId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateCuota = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { pagado, fecha_pago, monto, fecha_vencimiento, notas } = req.body;
        const cleanNum = (v) => v && String(v).trim() ? parseFloat(String(v).replace(/\./g,'').replace(',','.')) : null;
        const result = await client.query(
            `UPDATE im_cuotas SET pagado=$1, fecha_pago=$2, monto=$3, fecha_vencimiento=$4, notas=$5
             WHERE id=$6 RETURNING *`,
            [pagado === true || pagado === 'true', fecha_pago || null,
             cleanNum(monto), fecha_vencimiento || null, notas || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Cuota no encontrada.' });
        const cuota = result.rows[0];
        await auditLog(client, { tabla: 'im_cuotas', entidadId: cuota.venta_id,
            accion: pagado ? 'CUOTA_PAGADA' : 'CUOTA_ACTUALIZADA',
            descripcion: `Cuota N°${cuota.numero_cuota} ${pagado ? 'marcada como pagada' : 'actualizada'}.`, req });
        await client.query('COMMIT');
        res.json(cuota);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
};

exports.uploadComprobanteCuota = async (req, res) => {
    const { createClient } = require('@supabase/supabase-js');
    const path = require('path');
    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
    );
    const BUCKET = 'cygnus-documentos';

    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });
        const { id } = req.params;
        const ext = path.extname(req.file.originalname).toLowerCase();
        const storagePath = `cuotas/${id}/${Date.now()}${ext}`;

        const { error: uploadErr } = await supabaseAdmin.storage
            .from(BUCKET).upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });
        if (uploadErr) throw new Error(uploadErr.message);

        let url = storagePath;
        try {
            const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 365);
            if (data) url = data.signedUrl;
        } catch (_) {}

        const result = await pool.query(
            `UPDATE im_cuotas SET comprobante_url=$1, storage_path=$2, pagado=true, fecha_pago=COALESCE(fecha_pago, CURRENT_DATE)
             WHERE id=$3 RETURNING *, venta_id`, [url, storagePath, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Cuota no encontrada.' });
        const cuota = result.rows[0];

        // Registrar comprobante en im_documentos vinculado a la venta
        const cuotaNum = cuota.numero_cuota || id;
        const nombreDoc = `Comprobante Cuota N° ${cuotaNum}`;
        const userId = req.session.user ? req.session.user.id : null;
        await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, 'venta', $3, $4, $5)`,
            [nombreDoc, url, cuota.venta_id, userId, storagePath]
        ).catch(() => {}); // no bloquear si falla

        res.json(cuota);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.uploadComprobanteVenta = async (req, res) => {
    const { createClient } = require('@supabase/supabase-js');
    const path = require('path');
    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
    );
    const BUCKET = 'cygnus-documentos';

    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });
        const { id } = req.params;
        const ext = path.extname(req.file.originalname).toLowerCase();
        const storagePath = `ventas/${id}/comprobante${Date.now()}${ext}`;

        const { error: uploadErr } = await supabaseAdmin.storage
            .from(BUCKET).upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });
        if (uploadErr) throw new Error(uploadErr.message);

        let url = storagePath;
        try {
            const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 365);
            if (data) url = data.signedUrl;
        } catch (_) {}

        const result = await pool.query(
            `UPDATE im_ventas_lotes SET comprobante_url=$1, comprobante_path=$2 WHERE id=$3 RETURNING *`,
            [url, storagePath, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Venta no encontrada.' });

        // Registrar en im_documentos vinculado a la venta
        const userId = req.session.user ? req.session.user.id : null;
        await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, 'venta', $3, $4, $5)`,
            ['Comprobante de Pago', url, id, userId, storagePath]
        ).catch(() => {});

        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ==========================================
//  ACCESOS AL MÓDULO
// ==========================================

exports.getAccesos = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, u.role,
                   a.puede_crear,
                   CASE WHEN a.user_id IS NOT NULL THEN true ELSE false END as tiene_acceso
            FROM users u LEFT JOIN im_accesos a ON a.user_id = u.id
            WHERE u.role <> 'superadmin'
            ORDER BY tiene_acceso DESC, u.name ASC`);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.setAcceso = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        const { user_id, puede_crear } = req.body;
        if (!user_id) return res.status(400).json({ message: 'user_id requerido.' });
        const result = await pool.query(
            `INSERT INTO im_accesos (user_id, puede_crear) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET puede_crear=$2 RETURNING *`,
            [user_id, puede_crear === true || puede_crear === 'true']
        );
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteAcceso = async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores.' });
    try {
        await pool.query('DELETE FROM im_accesos WHERE user_id=$1', [req.params.userId]);
        res.sendStatus(204);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// Lista de usuarios/agentes para selector en venta
// Excluye cuentas genéricas/sistema por nombre
exports.getUsuarios = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, role FROM users
             WHERE name NOT ILIKE '%administrador%'
               AND name NOT ILIKE '%cygnus group%'
               AND name NOT ILIKE '%system%'
               AND name NOT ILIKE '%admin principal%'
             ORDER BY
               CASE WHEN role = 'corredor' THEN 0 ELSE 1 END,
               name ASC`
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ==========================================
//  AUDITORÍA
// ==========================================

exports.getReporte = async (req, res) => {
    try {
        const { proyectoId } = req.params;
        const result = await pool.query(
            `SELECT
                pa.numero_parcela,
                pa.numero_rol_parcela,
                pa.metraje,
                pa.estado_venta as estado_parcela,
                c.nombre_completo,
                c.rut,
                c.email,
                c.telefono,
                c.direccion,
                c.estado_civil,
                c.regimen_matrimonial,
                c.nombre_conyugue,
                c.rut_conyugue,
                c.email_conyugue,
                c.telefono_conyugue,
                v.id as venta_id,
                v.fecha_venta,
                v.tipo_pago,
                v.precio_lista,
                v.precio_acordado,
                v.monto_pie,
                v.numero_credito,
                v.numero_cuotas,
                v.monto_cuota,
                v.condiciones_compra,
                v.firmo_promesa,
                v.firmo_compraventa,
                v.agente_nombre,
                v.estado as estado_contrato,
                (SELECT COUNT(*) FROM im_cuotas q WHERE q.venta_id=v.id AND q.pagado=false) as cuotas_pendientes,
                (SELECT COUNT(*) FROM im_cuotas q WHERE q.venta_id=v.id AND q.pagado=true)  as cuotas_pagadas,
                (SELECT COALESCE(SUM(q.monto),0) FROM im_cuotas q WHERE q.venta_id=v.id AND q.pagado=false) as saldo_pendiente
             FROM im_parcelas pa
             LEFT JOIN im_ventas_lotes v ON v.parcela_id=pa.id AND v.estado='activa'
             LEFT JOIN im_clientes c ON v.cliente_id=c.id
             WHERE pa.proyecto_id=$1
             ORDER BY LENGTH(pa.numero_parcela::TEXT) ASC, pa.numero_parcela ASC`,
            [proyectoId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getAuditoria = async (req, res) => {
    try {
        const { entidad_id, tabla } = req.query;
        let query = `SELECT * FROM im_auditoria WHERE 1=1`;
        const params = [];
        if (entidad_id) { params.push(entidad_id); query += ` AND entidad_id=$${params.length}`; }
        if (tabla)      { params.push(tabla);       query += ` AND tabla_afectada=$${params.length}`; }
        query += ` ORDER BY fecha DESC LIMIT 100`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
