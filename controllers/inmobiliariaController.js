const { Pool } = require('pg');
const path = require('path');
const docStorage = require('../helpers/docStorage');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const isAdmin = (req) => {
    const role = String(req.session?.user?.role || '').toLowerCase();
    return role === 'admin' || role === 'administrador';
};

/** Normaliza RUT chileno: quita puntos, guiones y espacios; mayúsculas. */
function normalizeRut(rut) {
    return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase();
}

/** Expresión SQL para normalizar columna RUT. */
function rutSqlExpr(col = 'rut') {
    return `REPLACE(REPLACE(REPLACE(UPPER(COALESCE(${col},'')), '.', ''), '-', ''), ' ', '')`;
}

// Verificación lazy del esquema (por si el proceso no arrancó vía app.listen)
let _schemaReady = null;
function ensureSchemaOnce() {
    if (!_schemaReady) {
        try {
            const { ensureImSchema } = require('../helpers/ensureImSchema');
            _schemaReady = ensureImSchema(pool).catch((e) => {
                console.warn('[imSchema] lazy ensure falló:', e.message);
                _schemaReady = null;
            });
        } catch (e) {
            console.warn('[imSchema] no se pudo cargar helper:', e.message);
            _schemaReady = Promise.resolve();
        }
    }
    return _schemaReady || Promise.resolve();
}
// Arranque en background al cargar el módulo (Render/Vercel)
ensureSchemaOnce();

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

/**
 * Resuelve el ejecutivo desde users y usa siempre su nombre real.
 * Evita guardar un nombre manipulado/desactualizado desde el navegador.
 */
async function resolveVentaAgent(client, req, agenteIdBody) {
    const hasAgentField = Object.prototype.hasOwnProperty.call(req.body, 'agente_id');
    const requestedId = hasAgentField ? agenteIdBody : req.session?.user?.id;
    if (!requestedId) return { id: null, nombre: null };

    const result = await client.query(
        `SELECT id, name FROM users WHERE id::text=$1 LIMIT 1`,
        [String(requestedId)]
    );
    if (result.rows.length === 0) {
        const err = new Error('El ejecutivo seleccionado no existe o ya no está disponible.');
        err.status = 400;
        throw err;
    }
    return { id: result.rows[0].id, nombre: result.rows[0].name };
}

// ==========================================
//  PROYECTOS
// ==========================================

exports.getProyectos = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pr.*,
                   COUNT(pa.id)::int AS parcelas_reales,
                   COUNT(pa.id) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible')::int AS disponibles,
                   COUNT(pa.id) FILTER (WHERE pa.estado_venta='reservado')::int AS reservadas,
                   COUNT(pa.id) FILTER (WHERE pa.estado_venta='vendido')::int AS vendidas,
                   COALESCE(SUM(pa.precio_actual) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible'),0) AS valor_disponible
            FROM im_proyectos pr
            LEFT JOIN im_parcelas pa ON pa.proyecto_id=pr.id
            GROUP BY pr.id
            ORDER BY pr.creado_at DESC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createProyecto = async (req, res) => {
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
                (SELECT c.nombre_completo FROM im_ventas_lotes v JOIN im_clientes c ON v.cliente_id = c.id
                 WHERE v.parcela_id = p.id AND COALESCE(v.estado,'activa')='activa'
                 ORDER BY v.creado_at DESC LIMIT 1) as cliente_nombre
             FROM im_parcelas p WHERE p.proyecto_id = $1
             ORDER BY LENGTH(p.numero_parcela::TEXT) ASC, p.numero_parcela ASC`,
            [proyectoId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message, message: e.message }); }
};

exports.getParcelaById = async (req, res) => {
    try {
        await ensureSchemaOnce();
        const { id } = req.params;
        const ventaSelect = `
            SELECT v.id, v.parcela_id, v.cliente_id, v.firmo_promesa, v.firmo_compraventa,
                   v.forma_pago, v.fecha_venta, v.precio_lista, v.precio_acordado, v.notas,
                   v.tipo_pago, v.monto_pie, v.numero_credito, v.numero_cuotas, v.monto_cuota,
                   v.condiciones_compra, v.comprobante_url, v.comprobante_path,
                   v.agente_id, v.agente_nombre, v.estado, v.creado_at,
                   c.id as cliente_id, c.nombre_completo, c.rut, c.email, c.telefono,
                   c.estado_civil, c.regimen_matrimonial, c.nombre_conyugue, c.rut_conyugue,
                   c.email_conyugue, c.telefono_conyugue, c.direccion
            FROM im_ventas_lotes v
            JOIN im_clientes c ON v.cliente_id = c.id`;

        const [parcelaRes, historialRes, ventaRes] = await Promise.all([
            pool.query(
                `SELECT p.*, pr.nombre as proyecto_nombre, pr.numero_rol_1, pr.numero_rol_2, pr.numero_matriz,
                        pr.tipo_proyecto
                 FROM im_parcelas p JOIN im_proyectos pr ON p.proyecto_id = pr.id WHERE p.id = $1`, [id]
            ),
            pool.query(`SELECT precio, fecha_registro FROM im_historial_precios WHERE parcela_id=$1 ORDER BY fecha_registro ASC`, [id]),
            pool.query(
                `${ventaSelect}
                 WHERE v.parcela_id=$1 AND COALESCE(v.estado,'activa')='activa'
                 ORDER BY v.creado_at DESC LIMIT 1`, [id]
            )
        ]);
        if (parcelaRes.rows.length === 0) return res.status(404).json({ message: 'Parcela no encontrada.' });

        const parcela = parcelaRes.rows[0];
        let venta = ventaRes.rows[0] || null;

        // Reparar una venta desfasada solo cuando la parcela sigue marcada como
        // vendida/reservada. Si está disponible, no reactivar ventas históricas
        // liberadas después de eliminar o resciliar una operación.
        if (!venta && ['vendido', 'reservado'].includes(parcela.estado_venta)) {
            const fallback = await pool.query(
                `${ventaSelect}
                 WHERE v.parcela_id=$1 AND COALESCE(v.estado,'activa') <> 'resciliada'
                 ORDER BY v.creado_at DESC LIMIT 1`, [id]
            );
            if (fallback.rows[0]) {
                venta = fallback.rows[0];
                // Reparar estado de la venta para próximas cargas
                await pool.query(
                    `UPDATE im_ventas_lotes SET estado='activa'
                     WHERE id=$1 AND COALESCE(estado,'activa') <> 'activa'`,
                    [venta.id]
                ).catch(() => {});
                venta.estado = 'activa';
            }
        }

        // Sincronizar estado de parcela con la venta vigente
        if (venta) {
            const esperado = (venta.firmo_promesa && !venta.firmo_compraventa) ? 'reservado' : 'vendido';
            if (parcela.estado_venta !== esperado) {
                await pool.query(`UPDATE im_parcelas SET estado_venta=$1 WHERE id=$2`, [esperado, id]).catch(() => {});
                parcela.estado_venta = esperado;
            }
        }

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
             WHERE v.parcela_id=$1 AND COALESCE(v.estado,'activa') <> 'activa'
             ORDER BY v.creado_at DESC`, [id]
        );

        res.json({
            parcela,
            historial_precios: historialRes.rows,
            venta,
            cuotas,
            historial_ventas: historialVentasRes.rows
        });
    } catch (e) {
        console.error('[getParcelaById]', e.message);
        res.status(500).json({ error: e.message, message: e.message });
    }
};

exports.createParcela = async (req, res) => {
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
        await ensureSchemaOnce();
        const { q, proyecto_id } = req.query;
        let query = `
            SELECT c.*,
                (SELECT COUNT(*) FROM im_ventas_lotes v WHERE v.cliente_id = c.id) as total_compras
            FROM im_clientes c WHERE 1=1`;
        const params = [];
        if (q) {
            const qNorm = normalizeRut(q);
            params.push(`%${q}%`);
            const qIdx = params.length;
            params.push(qNorm);
            const rutIdx = params.length;
            query += ` AND (
                c.nombre_completo ILIKE $${qIdx}
                OR c.rut ILIKE $${qIdx}
                OR COALESCE(c.email,'') ILIKE $${qIdx}
                OR COALESCE(c.telefono,'') ILIKE $${qIdx}
                OR ${rutSqlExpr('c.rut')} LIKE '%' || $${rutIdx} || '%'
            )`;
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

        // Una sola query de ventas para todos los clientes (evita N+1 y agotar el pool)
        const ids = clientes.rows.map((c) => c.id);
        let ventasByCliente = {};
        if (ids.length > 0) {
            const ventas = await pool.query(
                `SELECT v.id as venta_id, v.tipo_pago, v.precio_acordado, v.fecha_venta,
                        v.firmo_promesa, v.firmo_compraventa, v.estado,
                        CASE
                          WHEN COALESCE(v.tipo_pago,'contado') <> 'credito' THEN NULL
                          WHEN NOT EXISTS (SELECT 1 FROM im_cuotas q WHERE q.venta_id = v.id) THEN 'sin_cuotas'
                          WHEN EXISTS (SELECT 1 FROM im_cuotas q WHERE q.venta_id = v.id AND q.pagado = false) THEN 'pendiente'
                          ELSE 'al_dia'
                        END as estado_cuotas,
                        pa.id as parcela_id, pa.numero_parcela, pa.numero_parcela as parcela_numero, pa.estado_venta,
                        pr.id as proyecto_id, pr.nombre as proyecto_nombre,
                        v.cliente_id
                 FROM im_ventas_lotes v
                 JOIN im_parcelas pa ON v.parcela_id = pa.id
                 JOIN im_proyectos pr ON pa.proyecto_id = pr.id
                 WHERE v.cliente_id = ANY($1::uuid[])
                 ORDER BY v.creado_at DESC`,
                [ids]
            );
            ventasByCliente = ventas.rows.reduce((acc, row) => {
                if (!acc[row.cliente_id]) acc[row.cliente_id] = [];
                acc[row.cliente_id].push(row);
                return acc;
            }, {});
        }

        const result = clientes.rows.map((c) => ({
            ...c,
            ventas: ventasByCliente[c.id] || []
        }));

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message, message: e.message }); }
};

exports.buscarClientePorRut = async (req, res) => {
    try {
        const { rut, q } = req.query;
        const term = (rut || q || '').trim();
        if (!term) return res.status(400).json({ message: 'Ingresa un RUT o nombre para buscar.' });

        const rutNorm = normalizeRut(term);
        const comprasSub = `(SELECT COUNT(*) FROM im_ventas_lotes v WHERE v.cliente_id = c.id) as total_compras,
                (SELECT STRING_AGG(pr.nombre || ' P' || pa.numero_parcela, ', ' ORDER BY v2.creado_at DESC)
                 FROM im_ventas_lotes v2
                 JOIN im_parcelas pa ON v2.parcela_id = pa.id
                 JOIN im_proyectos pr ON pa.proyecto_id = pr.id
                 WHERE v2.cliente_id = c.id AND COALESCE(v2.estado,'activa')='activa') as parcelas_compradas`;

        // Si parece RUT (contiene guion o solo dígitos+K), buscar por RUT normalizado
        const esRut = /[0-9kK]-/.test(term) || /^\d{7,9}[kK\d]?$/.test(rutNorm);
        if (esRut && rutNorm.length >= 7) {
            const r = await pool.query(
                `SELECT c.*, ${comprasSub} FROM im_clientes c WHERE ${rutSqlExpr('c.rut')} = $1 LIMIT 1`,
                [rutNorm]
            );
            if (r.rows.length > 0) return res.json(r.rows[0]);
        }

        // Búsqueda flexible por nombre o RUT (con y sin formato)
        const result = await pool.query(
            `SELECT c.*, ${comprasSub} FROM im_clientes c
             WHERE c.nombre_completo ILIKE $1
                OR c.rut ILIKE $1
                OR ${rutSqlExpr('c.rut')} LIKE '%' || $2 || '%'
             ORDER BY c.nombre_completo ASC LIMIT 8`,
            [`%${term}%`, rutNorm]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'No se encontró ningún cliente con ese nombre o RUT.' });
        if (result.rows.length === 1) return res.json(result.rows[0]);
        res.json({ multiple: true, clientes: result.rows });
    } catch (e) { res.status(500).json({ error: e.message, message: e.message }); }
};

exports.createCliente = async (req, res) => {
    try {
        await ensureSchemaOnce();
        const { nombre_completo, rut, direccion, estado_civil, regimen_matrimonial,
                nombre_conyugue, rut_conyugue, email_conyugue, telefono_conyugue,
                email, telefono, reuse_if_exists } = req.body;
        if (!nombre_completo || !rut) return res.status(400).json({ message: 'Nombre y RUT son obligatorios.' });

        const rutNorm = normalizeRut(rut);
        const existing = await pool.query(
            `SELECT * FROM im_clientes WHERE ${rutSqlExpr('rut')} = $1 LIMIT 1`,
            [rutNorm]
        );

        if (existing.rows.length > 0) {
            const cliente = existing.rows[0];
            // Desde ficha de venta: reutilizar y actualizar datos del formulario
            if (reuse_if_exists) {
                const updated = await pool.query(
                    `UPDATE im_clientes SET nombre_completo=$1, rut=$2, direccion=$3, estado_civil=$4,
                     regimen_matrimonial=$5, nombre_conyugue=$6, rut_conyugue=$7,
                     email_conyugue=$8, telefono_conyugue=$9, email=$10, telefono=$11
                     WHERE id=$12 RETURNING *`,
                    [nombre_completo, rut, direccion || null, estado_civil || 'Soltero/a',
                     regimen_matrimonial || null,
                     nombre_conyugue || null, rut_conyugue || null,
                     email_conyugue || null, telefono_conyugue || null,
                     email || null, telefono || null, cliente.id]
                );
                return res.status(200).json({ ...updated.rows[0], _existing: true });
            }
            return res.status(409).json({
                message: 'Ya existe un cliente con ese RUT.',
                cliente
            });
        }

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
        if (e.code === '23505') {
            try {
                const rutNorm = normalizeRut(req.body.rut);
                const existing = await pool.query(
                    `SELECT * FROM im_clientes WHERE ${rutSqlExpr('rut')} = $1 LIMIT 1`, [rutNorm]
                );
                if (existing.rows[0]) {
                    return res.status(409).json({
                        message: 'Ya existe un cliente con ese RUT.',
                        cliente: existing.rows[0]
                    });
                }
            } catch (_) {}
            return res.status(409).json({ message: 'Ya existe un cliente con ese RUT.' });
        }
        console.error('[createCliente]', e.message);
        res.status(500).json({ error: e.message, message: e.message });
    }
};

exports.updateCliente = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre_completo, rut, direccion, estado_civil, regimen_matrimonial,
                nombre_conyugue, rut_conyugue, email_conyugue, telefono_conyugue,
                email, telefono } = req.body;

        if (rut) {
            const rutNorm = normalizeRut(rut);
            const dup = await pool.query(
                `SELECT id FROM im_clientes WHERE ${rutSqlExpr('rut')} = $1 AND id <> $2 LIMIT 1`,
                [rutNorm, id]
            );
            if (dup.rows.length > 0) {
                return res.status(409).json({ message: 'Ya existe otro cliente con ese RUT.' });
            }
        }

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
        console.error('[updateCliente]', e.message);
        res.status(500).json({ error: e.message, message: e.message });
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
            agente_id
        } = req.body;
        if (!parcela_id || !cliente_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Parcela y cliente son obligatorios.' });
        }

        const cleanNum = (v) => v && String(v).trim() ? parseFloat(String(v).replace(/\./g,'').replace(',','.')) : null;

        // Marcar ventas activas anteriores como 'liberada' (no eliminar — preservar historial)
        await client.query(
            `UPDATE im_ventas_lotes SET estado='liberada' WHERE parcela_id=$1 AND COALESCE(estado,'activa')='activa'`,
            [parcela_id]
        );

        // Validar el ejecutivo contra users y guardar su nombre canónico.
        const agente = await resolveVentaAgent(client, req, agente_id);
        const agenteId = agente.id;
        const agenteNombre = agente.nombre;

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

        // Reservado solo si hay promesa SIN compraventa; cualquier otra venta = vendido
        const nuevoEstado = (firmo_promesa && !firmo_compraventa) ? 'reservado' : 'vendido';
        await client.query(`UPDATE im_parcelas SET estado_venta=$1 WHERE id=$2`, [nuevoEstado, parcela_id]);

        await auditLog(client, { tabla: 'im_ventas_lotes', entidadId: venta.id,
            accion: 'CREAR',
            descripcion: `Venta ${tipo_pago||'contado'} por ${agenteNombre || 'sin agente'}. Estado: ${nuevoEstado}. Precio: ${precio_acordado ? '$' + Number(cleanNum(precio_acordado)).toLocaleString('es-CL') : 'sin precio'}.`, req });

        await client.query('COMMIT');
        res.status(201).json(venta);
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[createVenta]', e.message);
        res.status(e.status || 500).json({ error: e.message, message: e.message });
    } finally { client.release(); }
};

exports.updateVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const {
            cliente_id, firmo_promesa, firmo_compraventa, forma_pago,
            fecha_venta, precio_lista, precio_acordado, notas,
            tipo_pago, monto_pie, numero_credito, numero_cuotas, monto_cuota,
            condiciones_compra, fechas_cuotas, agente_id
        } = req.body;
        if (!cliente_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'El cliente es obligatorio.' });
        }

        const current = await client.query(
            `SELECT id, parcela_id FROM im_ventas_lotes WHERE id=$1 FOR UPDATE`,
            [id]
        );
        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Venta no encontrada.' });
        }

        const cleanNum = (v) => v && String(v).trim()
            ? parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
            : null;
        const agente = await resolveVentaAgent(client, req, agente_id);
        await client.query(
            `UPDATE im_ventas_lotes
             SET estado='liberada'
             WHERE parcela_id=$1 AND id<>$2 AND COALESCE(estado,'activa')='activa'`,
            [current.rows[0].parcela_id, id]
        );
        const result = await client.query(
            `UPDATE im_ventas_lotes SET
                cliente_id=$1, firmo_promesa=$2, firmo_compraventa=$3, forma_pago=$4,
                fecha_venta=$5, precio_lista=$6, precio_acordado=$7, notas=$8,
                tipo_pago=$9, monto_pie=$10, numero_credito=$11, numero_cuotas=$12,
                monto_cuota=$13, condiciones_compra=$14, agente_id=$15,
                agente_nombre=$16, estado='activa'
             WHERE id=$17 RETURNING *`,
            [
                cliente_id, !!firmo_promesa, !!firmo_compraventa, forma_pago || null,
                fecha_venta || new Date().toISOString().split('T')[0],
                cleanNum(precio_lista), cleanNum(precio_acordado), notas || null,
                tipo_pago || 'contado', cleanNum(monto_pie), numero_credito || null,
                parseInt(numero_cuotas, 10) || 0, cleanNum(monto_cuota),
                condiciones_compra || null, agente.id, agente.nombre, id
            ]
        );
        const venta = result.rows[0];

        // Conservar pagos ya registrados al editar. Solo reemplazar el calendario
        // cuando el formulario envía expresamente nuevas fechas.
        if (tipo_pago !== 'credito') {
            const paid = await client.query(
                `SELECT COUNT(*)::int AS total FROM im_cuotas WHERE venta_id=$1 AND pagado=true`,
                [id]
            );
            if (paid.rows[0].total > 0) {
                const err = new Error('No se puede cambiar a contado porque la venta ya tiene cuotas pagadas.');
                err.status = 409;
                throw err;
            }
            await client.query(`DELETE FROM im_cuotas WHERE venta_id=$1`, [id]);
        } else if (Array.isArray(fechas_cuotas) && fechas_cuotas.length > 0) {
            const paid = await client.query(
                `SELECT COUNT(*)::int AS total FROM im_cuotas WHERE venta_id=$1 AND pagado=true`,
                [id]
            );
            if (paid.rows[0].total > 0) {
                const err = new Error('No se puede reemplazar el calendario porque ya existen cuotas pagadas.');
                err.status = 409;
                throw err;
            }
            await client.query(`DELETE FROM im_cuotas WHERE venta_id=$1`, [id]);
            for (let i = 0; i < fechas_cuotas.length; i++) {
                const cuota = fechas_cuotas[i];
                await client.query(
                    `INSERT INTO im_cuotas (venta_id, numero_cuota, monto, fecha_vencimiento)
                     VALUES ($1,$2,$3,$4)`,
                    [id, i + 1, cleanNum(cuota.monto) || cleanNum(monto_cuota), cuota.fecha || null]
                );
            }
        }

        const nuevoEstado = (firmo_promesa && !firmo_compraventa) ? 'reservado' : 'vendido';
        await client.query(
            `UPDATE im_parcelas SET estado_venta=$1 WHERE id=$2`,
            [nuevoEstado, current.rows[0].parcela_id]
        );
        await auditLog(client, {
            tabla: 'im_ventas_lotes',
            entidadId: id,
            accion: 'ACTUALIZAR',
            descripcion: `Venta actualizada. Ejecutivo: ${agente.nombre || 'sin asignar'}. Estado: ${nuevoEstado}.`,
            req
        });
        await client.query('COMMIT');
        res.json(venta);
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[updateVenta]', e.message);
        res.status(e.status || 500).json({ error: e.message, message: e.message });
    } finally {
        client.release();
    }
};

exports.deleteVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const ventaRes = await client.query(`SELECT parcela_id FROM im_ventas_lotes WHERE id=$1`, [id]);
        if (ventaRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Venta no encontrada.' });
        }
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
            `SELECT parcela_id FROM im_ventas_lotes WHERE id=$1 AND COALESCE(estado,'activa')='activa'`, [id]
        );
        if (ventaRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Venta activa no encontrada.' });
        }

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
    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });
        const { id } = req.params;
        const ext = path.extname(req.file.originalname).toLowerCase();
        const objectKey = `cuotas/${id}/${Date.now()}${ext}`;
        const uploaded = await docStorage.uploadDocument(req.file, objectKey);
        const url = uploaded.url_storage;
        const storagePath = uploaded.storage_path;

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
             VALUES ($1, $2, 'venta', $3::text, $4, $5)`,
            [nombreDoc, url, String(cuota.venta_id), userId, storagePath]
        ).catch(() => {}); // no bloquear si falla

        res.json(cuota);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.uploadComprobanteVenta = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });
        const { id } = req.params;
        const ext = path.extname(req.file.originalname).toLowerCase();
        const objectKey = `ventas/${id}/comprobante${Date.now()}${ext}`;
        const uploaded = await docStorage.uploadDocument(req.file, objectKey);
        const url = uploaded.url_storage;
        const storagePath = uploaded.storage_path;

        const result = await pool.query(
            `UPDATE im_ventas_lotes SET comprobante_url=$1, comprobante_path=$2 WHERE id=$3 RETURNING *`,
            [url, storagePath, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Venta no encontrada.' });

        // Registrar en im_documentos vinculado a la venta
        const userId = req.session.user ? req.session.user.id : null;
        await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ($1, $2, 'venta', $3::text, $4, $5)`,
            ['Comprobante de Pago', url, String(id), userId, storagePath]
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
             LEFT JOIN im_ventas_lotes v ON v.parcela_id=pa.id AND COALESCE(v.estado,'activa')='activa'
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

// ==========================================
//  RESCILIACIONES — gestión completa
// ==========================================

exports.getAllResciliaciones = async (req, res) => {
    try {
        const { proyecto_id } = req.query;
        const params = [];
        let where = [];
        if (proyecto_id) { params.push(proyecto_id); where.push(`pr.id = $${params.length}`); }
        const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const result = await pool.query(`
            SELECT
                r.id, r.fecha, r.motivo, r.notas, r.creado_por_nombre,
                r.tipo_devolucion, r.monto_total_devolucion, r.monto_pie_devolucion,
                r.numero_cuotas_devolucion, r.monto_cuota_devolucion,
                r.documento_url, r.documento_path, r.estado,
                v.id   AS venta_id,   v.tipo_pago, v.precio_acordado, v.fecha_venta,
                c.id   AS cliente_id, c.nombre_completo AS cliente_nombre,
                c.rut  AS cliente_rut, c.telefono AS cliente_telefono,
                c.email AS cliente_email, c.nombre_conyugue, c.rut_conyugue,
                c.telefono_conyugue, c.email_conyugue,
                pa.id  AS parcela_id, pa.numero_parcela,
                pr.id  AS proyecto_id, pr.nombre AS proyecto_nombre,
                (SELECT COUNT(*) FROM im_cuotas_devolucion cd
                 WHERE cd.resciliacion_id = r.id AND cd.pagado = false) AS cuotas_dev_pendientes,
                (SELECT COUNT(*) FROM im_cuotas_devolucion cd
                 WHERE cd.resciliacion_id = r.id) AS total_cuotas_dev,
                (SELECT COALESCE(SUM(cd.monto),0) FROM im_cuotas_devolucion cd
                 WHERE cd.resciliacion_id = r.id AND cd.pagado = false) AS monto_dev_pendiente,
                (SELECT COALESCE(SUM(cd.monto),0) FROM im_cuotas_devolucion cd
                 WHERE cd.resciliacion_id = r.id AND cd.pagado = true) AS monto_dev_pagado,
                (SELECT COUNT(*) FROM im_cuotas_devolucion cd
                 WHERE cd.resciliacion_id = r.id AND cd.pagado = false
                 AND cd.fecha_vencimiento < CURRENT_DATE) AS cuotas_dev_vencidas
            FROM im_resciliaciones r
            JOIN im_ventas_lotes  v  ON r.venta_id   = v.id
            JOIN im_clientes       c  ON v.cliente_id = c.id
            JOIN im_parcelas       pa ON r.parcela_id = pa.id
            JOIN im_proyectos      pr ON pa.proyecto_id = pr.id
            ${whereStr}
            ORDER BY r.fecha DESC, r.id DESC
        `, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getResciliacionById = async (req, res) => {
    try {
        const { id } = req.params;
        const [resc, cuotas] = await Promise.all([
            pool.query(`
                SELECT r.*,
                    v.tipo_pago, v.precio_acordado, v.fecha_venta,
                    c.nombre_completo AS cliente_nombre, c.rut AS cliente_rut,
                    c.telefono AS cliente_telefono, c.email AS cliente_email,
                    c.nombre_conyugue, c.rut_conyugue, c.telefono_conyugue, c.email_conyugue,
                    c.estado_civil, c.regimen_matrimonial,
                    pa.numero_parcela, pr.nombre AS proyecto_nombre
                FROM im_resciliaciones r
                JOIN im_ventas_lotes v ON r.venta_id = v.id
                JOIN im_clientes c ON v.cliente_id = c.id
                JOIN im_parcelas pa ON r.parcela_id = pa.id
                JOIN im_proyectos pr ON pa.proyecto_id = pr.id
                WHERE r.id = $1
            `, [id]),
            pool.query(
                `SELECT * FROM im_cuotas_devolucion WHERE resciliacion_id = $1 ORDER BY numero_cuota ASC`,
                [id]
            )
        ]);
        if (resc.rows.length === 0) return res.status(404).json({ message: 'Resciliación no encontrada.' });
        res.json({ resciliacion: resc.rows[0], cuotas: cuotas.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateResciliacion = async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo_devolucion, monto_total_devolucion, monto_pie_devolucion,
                numero_cuotas_devolucion, monto_cuota_devolucion, estado, notas } = req.body;
        const result = await pool.query(`
            UPDATE im_resciliaciones SET
                tipo_devolucion          = COALESCE($1, tipo_devolucion),
                monto_total_devolucion   = COALESCE($2, monto_total_devolucion),
                monto_pie_devolucion     = COALESCE($3, monto_pie_devolucion),
                numero_cuotas_devolucion = COALESCE($4, numero_cuotas_devolucion),
                monto_cuota_devolucion   = COALESCE($5, monto_cuota_devolucion),
                estado                   = COALESCE($6, estado),
                notas                    = COALESCE($7, notas)
            WHERE id = $8 RETURNING *
        `, [tipo_devolucion, monto_total_devolucion || null, monto_pie_devolucion || null,
            numero_cuotas_devolucion || null, monto_cuota_devolucion || null, estado, notas, id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Resciliación no encontrada.' });
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.setCuotasDevolucion = async (req, res) => {
    try {
        const { id } = req.params;
        const { cuotas } = req.body;
        if (!Array.isArray(cuotas) || cuotas.length === 0)
            return res.status(400).json({ message: 'Debes enviar al menos una cuota.' });
        // Solo elimina las no pagadas para no perder historial
        await pool.query(`DELETE FROM im_cuotas_devolucion WHERE resciliacion_id=$1 AND pagado=false`, [id]);
        for (const c of cuotas) {
            await pool.query(
                `INSERT INTO im_cuotas_devolucion (resciliacion_id, numero_cuota, monto, fecha_vencimiento)
                 VALUES ($1,$2,$3,$4)`,
                [id, c.numero_cuota, c.monto || null, c.fecha_vencimiento || null]
            );
        }
        const result = await pool.query(
            `SELECT * FROM im_cuotas_devolucion WHERE resciliacion_id=$1 ORDER BY numero_cuota ASC`, [id]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.pagarCuotaDevolucion = async (req, res) => {
    try {
        const { id } = req.params;
        const { fecha_pago, notas } = req.body;

        let comprobante_url = null, storage_path = null;
        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            const objectKey = `cuotas-dev/${id}/${Date.now()}${ext}`;
            const uploaded = await docStorage.uploadDocument(req.file, objectKey);
            storage_path = uploaded.storage_path;
            comprobante_url = uploaded.url_storage;
        }

        const sets = [`pagado=true`, `fecha_pago=COALESCE($1, CURRENT_DATE)`];
        const params = [fecha_pago || null];
        if (notas !== undefined) { params.push(notas); sets.push(`notas=$${params.length}`); }
        if (comprobante_url)     { params.push(comprobante_url); sets.push(`comprobante_url=$${params.length}`); }
        if (storage_path)        { params.push(storage_path);    sets.push(`storage_path=$${params.length}`); }
        params.push(id);

        const result = await pool.query(
            `UPDATE im_cuotas_devolucion SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *, resciliacion_id`,
            params
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Cuota de devolución no encontrada.' });

        // Registrar en im_documentos como doc del parcela de la resciliación
        if (comprobante_url) {
            const cuota = result.rows[0];
            const rescRes = await pool.query(`SELECT parcela_id FROM im_resciliaciones WHERE id=$1`, [cuota.resciliacion_id]);
            if (rescRes.rows.length > 0) {
                await pool.query(
                    `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
                     VALUES ($1,$2,'parcela',$3::text,$4,$5)`,
                    [`Comprobante Devolución Cuota N° ${cuota.numero_cuota}`, comprobante_url,
                     String(rescRes.rows[0].parcela_id), req.session.user?.id || null, storage_path]
                ).catch(() => {});
            }
        }
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.uploadDocumentoResciliacion = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No se recibió archivo.' });
        const { id } = req.params;

        const rescRes = await pool.query(`SELECT parcela_id, venta_id FROM im_resciliaciones WHERE id=$1`, [id]);
        if (rescRes.rows.length === 0) return res.status(404).json({ message: 'Resciliación no encontrada.' });
        const { parcela_id } = rescRes.rows[0];

        const ext = path.extname(req.file.originalname).toLowerCase();
        const objectKey = `resciliaciones/${id}/${Date.now()}${ext}`;
        const uploaded = await docStorage.uploadDocument(req.file, objectKey);
        const url = uploaded.url_storage;
        const storage_path = uploaded.storage_path;

        // Actualizar resciliación
        await pool.query(
            `UPDATE im_resciliaciones SET documento_url=$1, documento_path=$2 WHERE id=$3`,
            [url, storage_path, id]
        );

        // Registrar en im_documentos (asociado a la parcela)
        await pool.query(
            `INSERT INTO im_documentos (nombre_personalizado, url_storage, tipo_asociacion, asociacion_id, subido_por, storage_path)
             VALUES ('Documento de Resciliación',$1,'parcela',$2::text,$3,$4)`,
            [url, String(parcela_id), req.session.user?.id || null, storage_path]
        ).catch(() => {});

        res.json({ url, storage_path });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getParcelasVendidas = async (req, res) => {
    try {
        const { proyecto_id } = req.query;
        if (!proyecto_id) return res.status(400).json({ message: 'proyecto_id es requerido.' });
        const result = await pool.query(`
            SELECT pa.id, pa.numero_parcela,
                   v.id AS venta_id, v.precio_acordado, v.tipo_pago, v.fecha_venta,
                   c.nombre_completo AS cliente_nombre, c.rut AS cliente_rut
            FROM im_parcelas pa
            JOIN im_ventas_lotes v ON v.parcela_id = pa.id AND v.estado = 'activa'
            JOIN im_clientes c ON v.cliente_id = c.id
            WHERE pa.proyecto_id = $1
            ORDER BY LENGTH(pa.numero_parcela), pa.numero_parcela
        `, [proyecto_id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ==========================================
//  CARTERA EJECUTIVA — métricas reales
// ==========================================

exports.getCartera = async (req, res) => {
    try {
        await ensureSchemaOnce();
        const { proyecto_id, tipo_proyecto } = req.query;
        const params = [];
        const filters = [];
        if (proyecto_id) {
            params.push(proyecto_id);
            filters.push(`pr.id=$${params.length}`);
        }
        if (tipo_proyecto) {
            params.push(tipo_proyecto);
            filters.push(`pr.tipo_proyecto=$${params.length}`);
        }
        const projectWhere = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const projectAnd = filters.length ? `AND ${filters.join(' AND ')}` : '';

        const [
            inventarioRes,
            ventasRes,
            cuotasRes,
            proyectosRes,
            tiposRes,
            agentesRes,
            resciliacionesRes,
            tendenciaRes,
            alertasRes
        ] = await Promise.all([
            pool.query(`
                SELECT COUNT(pa.id)::int AS total,
                       COUNT(pa.id) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible')::int AS disponibles,
                       COUNT(pa.id) FILTER (WHERE pa.estado_venta='reservado')::int AS reservadas,
                       COUNT(pa.id) FILTER (WHERE pa.estado_venta='vendido')::int AS vendidas,
                       COALESCE(SUM(pa.precio_actual),0) AS valor_lista_total,
                       COALESCE(SUM(pa.precio_actual) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible'),0) AS valor_inventario_disponible,
                       COALESCE(SUM(pa.metraje),0) AS metraje_total,
                       COALESCE(SUM(pa.metraje) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible'),0) AS metraje_disponible
                FROM im_proyectos pr
                LEFT JOIN im_parcelas pa ON pa.proyecto_id=pr.id
                ${projectWhere}
            `, params),
            pool.query(`
                SELECT COUNT(v.id)::int AS operaciones_activas,
                       COUNT(v.id) FILTER (WHERE COALESCE(v.firmo_compraventa,false)=true)::int AS ventas_cerradas,
                       COUNT(v.id) FILTER (WHERE COALESCE(v.firmo_compraventa,false)=false)::int AS reservas_vigentes,
                       COUNT(v.id) FILTER (WHERE COALESCE(v.firmo_promesa,false)=true)::int AS promesas_firmadas,
                       COUNT(DISTINCT v.cliente_id)::int AS clientes_activos,
                       COUNT(v.id) FILTER (WHERE COALESCE(v.tipo_pago,'contado')='contado')::int AS operaciones_contado,
                       COUNT(v.id) FILTER (WHERE v.tipo_pago='credito')::int AS operaciones_credito,
                       COALESCE(SUM(v.precio_acordado),0) AS cartera_acordada,
                       COALESCE(SUM(v.precio_acordado) FILTER (WHERE COALESCE(v.tipo_pago,'contado')='contado'),0) AS monto_contado,
                       COALESCE(SUM(v.precio_acordado) FILTER (WHERE v.tipo_pago='credito'),0) AS monto_credito,
                       COALESCE(SUM(v.monto_pie) FILTER (WHERE v.tipo_pago='credito'),0) AS pie_comprometido,
                       COALESCE(SUM(GREATEST(COALESCE(v.precio_lista,0)-COALESCE(v.precio_acordado,0),0)),0) AS descuento_total,
                       COALESCE(AVG(v.precio_acordado) FILTER (WHERE v.precio_acordado IS NOT NULL),0) AS ticket_promedio
                FROM im_ventas_lotes v
                JOIN im_parcelas pa ON pa.id=v.parcela_id
                JOIN im_proyectos pr ON pr.id=pa.proyecto_id
                WHERE COALESCE(v.estado,'activa')='activa' ${projectAnd}
            `, params),
            pool.query(`
                SELECT COUNT(q.id)::int AS cuotas_total,
                       COUNT(q.id) FILTER (WHERE q.pagado=true)::int AS cuotas_pagadas,
                       COUNT(q.id) FILTER (WHERE q.pagado=false)::int AS cuotas_pendientes,
                       COUNT(q.id) FILTER (WHERE q.pagado=false AND q.fecha_vencimiento<CURRENT_DATE)::int AS cuotas_vencidas,
                       COALESCE(SUM(q.monto) FILTER (WHERE q.pagado=true),0) AS monto_cobrado,
                       COALESCE(SUM(q.monto) FILTER (WHERE q.pagado=false),0) AS saldo_pendiente,
                       COALESCE(SUM(q.monto) FILTER (WHERE q.pagado=false AND q.fecha_vencimiento<CURRENT_DATE),0) AS monto_mora,
                       COUNT(DISTINCT q.venta_id) FILTER (
                           WHERE q.pagado=false AND q.fecha_vencimiento<CURRENT_DATE
                       )::int AS contratos_en_mora,
                       COUNT(q.id) FILTER (
                           WHERE q.pagado=false AND q.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '30 days'
                       )::int AS vencen_30_dias
                FROM im_cuotas q
                JOIN im_ventas_lotes v ON v.id=q.venta_id AND COALESCE(v.estado,'activa')='activa'
                JOIN im_parcelas pa ON pa.id=v.parcela_id
                JOIN im_proyectos pr ON pr.id=pa.proyecto_id
                WHERE 1=1 ${projectAnd}
            `, params),
            pool.query(`
                WITH inv AS (
                    SELECT pr.id, pr.nombre, pr.tipo_proyecto, pr.estado,
                           COUNT(pa.id)::int AS total,
                           COUNT(pa.id) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible')::int AS disponibles,
                           COUNT(pa.id) FILTER (WHERE pa.estado_venta='reservado')::int AS reservadas,
                           COUNT(pa.id) FILTER (WHERE pa.estado_venta='vendido')::int AS vendidas,
                           COALESCE(SUM(pa.precio_actual) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible'),0) AS valor_disponible
                    FROM im_proyectos pr
                    LEFT JOIN im_parcelas pa ON pa.proyecto_id=pr.id
                    ${projectWhere}
                    GROUP BY pr.id
                ), ven AS (
                    SELECT pa.proyecto_id,
                           COUNT(v.id)::int AS operaciones,
                           COALESCE(SUM(v.precio_acordado),0) AS cartera,
                           COUNT(v.id) FILTER (WHERE v.tipo_pago='credito')::int AS creditos
                    FROM im_ventas_lotes v
                    JOIN im_parcelas pa ON pa.id=v.parcela_id
                    WHERE COALESCE(v.estado,'activa')='activa'
                    GROUP BY pa.proyecto_id
                ), cob AS (
                    SELECT pa.proyecto_id,
                           COALESCE(SUM(q.monto) FILTER (WHERE q.pagado=false),0) AS saldo,
                           COALESCE(SUM(q.monto) FILTER (WHERE q.pagado=false AND q.fecha_vencimiento<CURRENT_DATE),0) AS mora
                    FROM im_cuotas q
                    JOIN im_ventas_lotes v ON v.id=q.venta_id AND COALESCE(v.estado,'activa')='activa'
                    JOIN im_parcelas pa ON pa.id=v.parcela_id
                    GROUP BY pa.proyecto_id
                )
                SELECT inv.*, COALESCE(ven.operaciones,0)::int AS operaciones,
                       COALESCE(ven.cartera,0) AS cartera, COALESCE(ven.creditos,0)::int AS creditos,
                       COALESCE(cob.saldo,0) AS saldo, COALESCE(cob.mora,0) AS mora
                FROM inv
                LEFT JOIN ven ON ven.proyecto_id=inv.id
                LEFT JOIN cob ON cob.proyecto_id=inv.id
                ORDER BY inv.nombre
            `, params),
            pool.query(`
                SELECT COALESCE(pr.tipo_proyecto,'en_verde') AS tipo,
                       COUNT(pa.id)::int AS total,
                       COUNT(pa.id) FILTER (WHERE COALESCE(pa.estado_venta,'disponible')='disponible')::int AS disponibles,
                       COUNT(pa.id) FILTER (WHERE pa.estado_venta='reservado')::int AS reservadas,
                       COUNT(pa.id) FILTER (WHERE pa.estado_venta='vendido')::int AS vendidas
                FROM im_proyectos pr
                LEFT JOIN im_parcelas pa ON pa.proyecto_id=pr.id
                ${projectWhere}
                GROUP BY COALESCE(pr.tipo_proyecto,'en_verde')
                ORDER BY tipo
            `, params),
            pool.query(`
                SELECT v.agente_id,
                       COALESCE(NULLIF(MAX(u.name),''),MAX(NULLIF(v.agente_nombre,'')),'Sin asignar') AS agente,
                       COUNT(v.id)::int AS operaciones,
                       COUNT(v.id) FILTER (WHERE COALESCE(v.firmo_compraventa,false)=true)::int AS cerradas,
                       COUNT(v.id) FILTER (WHERE COALESCE(v.firmo_compraventa,false)=false)::int AS reservas,
                       COALESCE(SUM(v.precio_acordado),0) AS monto,
                       COALESCE(AVG(v.precio_acordado) FILTER (WHERE v.precio_acordado IS NOT NULL),0) AS ticket,
                       MAX(COALESCE(v.fecha_venta,v.creado_at::date)) AS ultima_venta
                FROM im_ventas_lotes v
                JOIN im_parcelas pa ON pa.id=v.parcela_id
                JOIN im_proyectos pr ON pr.id=pa.proyecto_id
                LEFT JOIN users u ON u.id::text=v.agente_id::text
                WHERE COALESCE(v.estado,'activa')='activa' ${projectAnd}
                GROUP BY v.agente_id,
                         CASE WHEN v.agente_id IS NULL
                              THEN COALESCE(NULLIF(v.agente_nombre,''),'Sin asignar')
                              ELSE '' END
                ORDER BY monto DESC, operaciones DESC
            `, params),
            pool.query(`
                SELECT COUNT(DISTINCT r.id)::int AS total_resciliaciones,
                       COUNT(DISTINCT r.id) FILTER (WHERE COALESCE(r.estado,'activa')='activa')::int AS devoluciones_abiertas,
                       COALESCE(SUM(cd.monto) FILTER (WHERE cd.pagado=false),0) AS devolucion_pendiente,
                       COALESCE(SUM(cd.monto) FILTER (WHERE cd.pagado=false AND cd.fecha_vencimiento<CURRENT_DATE),0) AS devolucion_vencida
                FROM im_resciliaciones r
                JOIN im_parcelas pa ON pa.id=r.parcela_id
                JOIN im_proyectos pr ON pr.id=pa.proyecto_id
                LEFT JOIN im_cuotas_devolucion cd ON cd.resciliacion_id=r.id
                WHERE 1=1 ${projectAnd}
            `, params),
            pool.query(`
                SELECT TO_CHAR(m.mes,'YYYY-MM') AS mes,
                       TO_CHAR(m.mes,'Mon YY') AS etiqueta,
                       COUNT(v.id)::int AS operaciones,
                       COALESCE(SUM(v.precio_acordado),0) AS monto
                FROM GENERATE_SERIES(
                    DATE_TRUNC('month',CURRENT_DATE)-INTERVAL '11 months',
                    DATE_TRUNC('month',CURRENT_DATE),
                    INTERVAL '1 month'
                ) m(mes)
                LEFT JOIN (
                    SELECT v.*
                    FROM im_ventas_lotes v
                    JOIN im_parcelas pa ON pa.id=v.parcela_id
                    JOIN im_proyectos pr ON pr.id=pa.proyecto_id
                    WHERE COALESCE(v.estado,'activa')='activa' ${projectAnd}
                ) v ON DATE_TRUNC('month',COALESCE(v.fecha_venta,v.creado_at))=m.mes
                GROUP BY m.mes
                ORDER BY m.mes
            `, params),
            pool.query(`
                SELECT q.id, q.numero_cuota, q.monto, q.fecha_vencimiento,
                       CURRENT_DATE-q.fecha_vencimiento AS dias_atraso,
                       c.nombre_completo AS cliente, c.telefono,
                       pa.id AS parcela_id, pa.numero_parcela,
                       pr.nombre AS proyecto
                FROM im_cuotas q
                JOIN im_ventas_lotes v ON v.id=q.venta_id AND COALESCE(v.estado,'activa')='activa'
                JOIN im_clientes c ON c.id=v.cliente_id
                JOIN im_parcelas pa ON pa.id=v.parcela_id
                JOIN im_proyectos pr ON pr.id=pa.proyecto_id
                WHERE q.pagado=false AND q.fecha_vencimiento<CURRENT_DATE ${projectAnd}
                ORDER BY q.fecha_vencimiento ASC
                LIMIT 12
            `, params)
        ]);

        res.json({
            inventario: inventarioRes.rows[0],
            ventas: ventasRes.rows[0],
            cobranza: cuotasRes.rows[0],
            resciliaciones: resciliacionesRes.rows[0],
            proyectos: proyectosRes.rows,
            tipos: tiposRes.rows,
            agentes: agentesRes.rows,
            tendencia: tendenciaRes.rows,
            alertas_mora: alertasRes.rows,
            generado_en: new Date().toISOString()
        });
    } catch (e) {
        console.error('[getCartera]', e.message);
        res.status(500).json({ error: e.message, message: e.message });
    }
};
