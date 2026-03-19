const { Pool } = require('pg');

// Conexión nativa a la base de datos de Cygnus
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Helper de seguridad integrado con Cygnus
const isAdmin = (req) => req.session.user && req.session.user.role === 'admin';

exports.getClientes = async (req, res) => {
    try {
        const userId = req.session.user.id; 
        let query, params;

        if (isAdmin(req)) {
            query = 'SELECT c.*, u.name as vendedor_nombre FROM clientes c LEFT JOIN users u ON c.usuario_id = u.id ORDER BY c.creado_en DESC';
            params = [];
        } else {
            query = 'SELECT * FROM clientes WHERE usuario_id = $1 ORDER BY creado_en DESC';
            params = [userId];
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createCliente = async (req, res) => {
    try {
        const { nombre, rut, email, telefono, notas } = req.body;
        const result = await pool.query(
            'INSERT INTO clientes (usuario_id, nombre, rut, email, telefono, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.session.user.id, nombre, rut, email, telefono, notas]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateCliente = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, rut, email, telefono, notas } = req.body;
        
        let query = `UPDATE clientes SET nombre=$1, rut=$2, email=$3, telefono=$4, notas=$5 WHERE id=$6`;
        let params = [nombre, rut, email, telefono, notas, id];

        if (!isAdmin(req)) {
            query += ` AND usuario_id=$7`;
            params.push(req.session.user.id);
        }

        query += ` RETURNING *`;
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) return res.status(404).json({ message: 'No encontrado o sin permisos' });
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteCliente = async (req, res) => {
    try {
        const { id } = req.params;
        let query = 'DELETE FROM clientes WHERE id = $1';
        let params = [id];

        if (!isAdmin(req)) {
            query += ' AND usuario_id = $2';
            params.push(req.session.user.id);
        }
        
        query += ' RETURNING id';
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado o sin permisos' });
        res.sendStatus(204);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ==========================================
// VISITAS
// ==========================================

exports.getVisitas = async (req, res) => {
    try {
        let query = `
            SELECT v.*, c.nombre as cliente_nombre, p.nombre as proyecto_nombre, l.numero_lote, u.name as vendedor_nombre
            FROM visitas v
            JOIN clientes c ON v.cliente_id = c.id
            JOIN proyectos p ON v.proyecto_id = p.id
            LEFT JOIN lotes l ON v.lote_id = l.id
            JOIN users u ON v.usuario_id = u.id
        `;
        let params = [];

        if (!isAdmin(req)) {
            query += ` WHERE v.usuario_id = $1`;
            params.push(req.session.user.id);
        }

        query += ` ORDER BY v.fecha_visita ASC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createVisita = async (req, res) => {
    try {
        const { cliente_id, proyecto_id, lote_id, fecha_visita, notas } = req.body;
        const result = await pool.query(
            'INSERT INTO visitas (usuario_id, cliente_id, proyecto_id, lote_id, fecha_visita, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.session.user.id, cliente_id, proyecto_id, lote_id || null, fecha_visita, notas]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ==========================================
// VENTAS Y RESERVAS FINANCIERAS (CORE)
// ==========================================

exports.getReservaByLote = async (req, res) => {
    try {
        const { loteId } = req.params;
        const query = `SELECT * FROM ventas WHERE lote_id = $1 AND tipo_operacion = 'reserva' ORDER BY fecha_venta DESC LIMIT 1`;
        const result = await pool.query(query, [loteId]);
        res.json(result.rows.length > 0 ? result.rows[0] : null);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getVentas = async (req, res) => {
    try {
        let query = `
            SELECT v.*, c.nombre as cliente_nombre, c.rut as cliente_rut, 
                   p.nombre as proyecto_nombre, l.numero_lote, u.name as vendedor_nombre,
                   (SELECT COUNT(*) FROM pagos_credito pc WHERE pc.venta_id = v.id AND pc.estado = 'Pendiente') as cuotas_pendientes
            FROM ventas v
            JOIN clientes c ON v.cliente_id = c.id
            JOIN proyectos p ON v.proyecto_id = p.id
            JOIN lotes l ON v.lote_id = l.id
            JOIN users u ON v.usuario_id = u.id 
        `;
        let params = [];

        if (!isAdmin(req)) {
            query += ` WHERE v.usuario_id = $1 `;
            params.push(req.session.user.id);
        }

        query += ` ORDER BY v.fecha_venta DESC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createVenta = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Recepción de datos básicos + financieros completos
        const { 
            cliente_id, proyecto_id, lote_id, tipo_operacion, 
            precio_lista, precio_acordado, monto_reserva, valor_final,
            metodo_pago, notas_generales, 
            monto_pie, cantidad_cuotas, tasa_interes,
            banco, numero_documento, fecha_pago_inicial, fecha_reserva
        } = req.body;

        const userId = req.session.user.id;

        // Estructuramos todos los detalles financieros en un JSON para no perder ningún dato
        const detalles_financieros = JSON.stringify({
            monto_pie: Number(monto_pie) || 0,
            cantidad_cuotas: Number(cantidad_cuotas) || 0,
            tasa_interes: Number(tasa_interes) || 0,
            banco: banco || 'No especificado',
            numero_documento: numero_documento || '',
            fecha_reserva: fecha_reserva || new Date().toISOString(),
            fecha_pago_inicial: fecha_pago_inicial || null,
            comentarios_adicionales: notas_generales || ''
        });

        // 1. Insertar Venta/Reserva
        const ventaRes = await client.query(
            `INSERT INTO ventas (
                usuario_id, cliente_id, proyecto_id, lote_id, tipo_operacion, 
                precio_lista, precio_acordado, monto_reserva, valor_final, 
                metodo_pago, notas
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                userId, cliente_id, proyecto_id, lote_id, tipo_operacion,
                precio_lista, precio_acordado, monto_reserva || 0, valor_final,
                metodo_pago, detalles_financieros
            ]
        );
        const nuevaVenta = ventaRes.rows[0];

        // 2. Generación automática de Cuotas (Si aplica)
        const numCuotas = Number(cantidad_cuotas) || 0;
        if (tipo_operacion === 'venta' && numCuotas > 0) {
            const pie = Number(monto_pie) || 0;
            const reserva = Number(monto_reserva) || 0;
            const precioAcordado = Number(precio_acordado);
            
            // Monto a financiar (Restando pie y reserva)
            const montoFinanciar = precioAcordado - pie - reserva;
            
            // Cálculo simple de interés sobre el total (ajustable según política de Cygnus)
            const interesTotal = montoFinanciar * ((Number(tasa_interes) || 0) / 100);
            const montoFinanciarConInteres = montoFinanciar + interesTotal;
            const valorCuotaMensual = montoFinanciarConInteres / numCuotas;

            let fechaVencimientoActual = fecha_pago_inicial ? new Date(fecha_pago_inicial) : new Date();

            for (let i = 1; i <= numCuotas; i++) {
                // Sumar un mes a la fecha de vencimiento
                fechaVencimientoActual.setMonth(fechaVencimientoActual.getMonth() + 1);
                const fechaSQL = fechaVencimientoActual.toISOString().split('T')[0];

                await client.query(
                    `INSERT INTO pagos_credito (
                        venta_id, numero_cuota, monto_cuota_uf, fecha_vencimiento, estado
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [nuevaVenta.id, i, valorCuotaMensual, fechaSQL, 'Pendiente']
                );
            }
        }

        // 3. Actualizar Estado del Lote (Visor en Vivo)
        // 2 = Reservado, 3 = Vendido
        const nuevoEstado = tipo_operacion === 'reserva' ? 2 : 3;
        await client.query('UPDATE lotes SET estado_id = $1 WHERE id = $2', [nuevoEstado, lote_id]);

        // 4. Registro de Auditoría
        await client.query(
            `INSERT INTO registro_actividad (usuario_id, accion, entidad_afectada, entidad_id, detalles) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
                userId, 
                `Crear ${tipo_operacion.toUpperCase()}`, 
                'ventas', 
                nuevaVenta.id, 
                JSON.stringify({ lote_id, precio_acordado, metodo_pago })
            ]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Operación financiera registrada exitosamente', data: nuevaVenta });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error en Operación de Venta:', e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
};