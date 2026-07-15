/**
 * Asegura que las tablas/columnas del módulo Gestión de Campos (im_*)
 * existan en PostgreSQL. Idempotente — seguro llamar en cada arranque.
 * Corrige el desfase entre código desplegado y BD en Render/Supabase.
 */
async function ensureImSchema(pool) {
    const statements = [
        // ── Clientes: columnas agregadas en commits posteriores ──
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS email TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS telefono TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS direccion TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS estado_civil VARCHAR(40) DEFAULT 'Soltero/a'`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS regimen_matrimonial TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS nombre_conyugue TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS rut_conyugue TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS email_conyugue TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS telefono_conyugue TEXT`,
        `ALTER TABLE im_clientes ADD COLUMN IF NOT EXISTS creado_at TIMESTAMPTZ DEFAULT NOW()`,

        // ── Ventas: columnas de pago / agente / estado ──
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS firmo_promesa BOOLEAN DEFAULT false`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS firmo_compraventa BOOLEAN DEFAULT false`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS forma_pago TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS fecha_venta DATE`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS precio_lista NUMERIC`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS precio_acordado NUMERIC`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS notas TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS tipo_pago VARCHAR(20) DEFAULT 'contado'`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS monto_pie NUMERIC`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS numero_credito TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS numero_cuotas INTEGER DEFAULT 0`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS monto_cuota NUMERIC`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS condiciones_compra TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS comprobante_url TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS comprobante_path TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS agente_id UUID`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS agente_nombre TEXT`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activa'`,
        `ALTER TABLE im_ventas_lotes ADD COLUMN IF NOT EXISTS creado_at TIMESTAMPTZ DEFAULT NOW()`,

        // ── Proyectos / parcelas ──
        `ALTER TABLE im_proyectos ADD COLUMN IF NOT EXISTS tipo_proyecto VARCHAR(30) DEFAULT 'en_verde'`,
        `ALTER TABLE im_proyectos ADD COLUMN IF NOT EXISTS numero_rol_1 TEXT`,
        `ALTER TABLE im_proyectos ADD COLUMN IF NOT EXISTS numero_rol_2 TEXT`,
        `ALTER TABLE im_proyectos ADD COLUMN IF NOT EXISTS numero_matriz TEXT`,
        `ALTER TABLE im_parcelas ADD COLUMN IF NOT EXISTS numero_rol_parcela TEXT`,
        `ALTER TABLE im_parcelas ADD COLUMN IF NOT EXISTS metraje NUMERIC`,
        `ALTER TABLE im_parcelas ADD COLUMN IF NOT EXISTS precio_actual NUMERIC`,
        `ALTER TABLE im_parcelas ADD COLUMN IF NOT EXISTS estado_venta VARCHAR(20) DEFAULT 'disponible'`,

        // ── Documentos ──
        `ALTER TABLE im_documentos ADD COLUMN IF NOT EXISTS storage_path TEXT`,
        `ALTER TABLE im_documentos ADD COLUMN IF NOT EXISTS subido_por UUID`,

        // ── Accesos ──
        `ALTER TABLE im_accesos ADD COLUMN IF NOT EXISTS puede_crear BOOLEAN DEFAULT false`,

        // ── Resciliaciones (campos de devolución) ──
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS tipo_devolucion TEXT`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS monto_total_devolucion NUMERIC`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS monto_pie_devolucion NUMERIC`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS numero_cuotas_devolucion INTEGER`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS monto_cuota_devolucion NUMERIC`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS documento_url TEXT`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS documento_path TEXT`,
        `ALTER TABLE im_resciliaciones ADD COLUMN IF NOT EXISTS estado VARCHAR(30) DEFAULT 'activa'`,

        // ── Cuotas de pago ──
        `CREATE TABLE IF NOT EXISTS im_cuotas (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            venta_id UUID NOT NULL REFERENCES im_ventas_lotes(id) ON DELETE CASCADE,
            numero_cuota INTEGER NOT NULL,
            monto NUMERIC,
            fecha_vencimiento DATE,
            fecha_pago DATE,
            pagado BOOLEAN NOT NULL DEFAULT false,
            comprobante_url TEXT,
            storage_path TEXT,
            notas TEXT,
            creado_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // ── Cuotas de devolución (resciliación) ──
        `CREATE TABLE IF NOT EXISTS im_cuotas_devolucion (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            resciliacion_id UUID NOT NULL REFERENCES im_resciliaciones(id) ON DELETE CASCADE,
            numero_cuota INTEGER NOT NULL,
            monto NUMERIC,
            fecha_vencimiento DATE,
            fecha_pago DATE,
            pagado BOOLEAN NOT NULL DEFAULT false,
            comprobante_url TEXT,
            storage_path TEXT,
            notas TEXT,
            creado_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // ── RLS: abrir acceso backend (mismo criterio IRRESTRICTO del CRM) ──
        `ALTER TABLE IF EXISTS im_clientes NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_clientes DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_parcelas NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_parcelas DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_proyectos NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_proyectos DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_ventas_lotes NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_ventas_lotes DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_cuotas NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_cuotas DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_cuotas_devolucion NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_cuotas_devolucion DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_documentos NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_documentos DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_historial_precios NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_historial_precios DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_resciliaciones NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_resciliaciones DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_auditoria NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_auditoria DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_accesos NO FORCE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS im_accesos DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS accesos_im DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE IF EXISTS proyectos_im DISABLE ROW LEVEL SECURITY`,
        // Políticas permisivas por si DISABLE no aplica (rol sin privilegio)
        `DROP POLICY IF EXISTS im_backend_all ON im_ventas_lotes`,
        `CREATE POLICY im_backend_all ON im_ventas_lotes FOR ALL USING (true) WITH CHECK (true)`,
        `DROP POLICY IF EXISTS im_backend_all ON im_clientes`,
        `CREATE POLICY im_backend_all ON im_clientes FOR ALL USING (true) WITH CHECK (true)`,
        `DROP POLICY IF EXISTS im_backend_all ON im_parcelas`,
        `CREATE POLICY im_backend_all ON im_parcelas FOR ALL USING (true) WITH CHECK (true)`,
        `DROP POLICY IF EXISTS im_backend_all ON im_cuotas`,
        `CREATE POLICY im_backend_all ON im_cuotas FOR ALL USING (true) WITH CHECK (true)`,
        `DROP POLICY IF EXISTS im_backend_all ON im_proyectos`,
        `CREATE POLICY im_backend_all ON im_proyectos FOR ALL USING (true) WITH CHECK (true)`,
        `DROP POLICY IF EXISTS im_backend_all ON im_documentos`,
        `CREATE POLICY im_backend_all ON im_documentos FOR ALL USING (true) WITH CHECK (true)`,
    ];

    let applied = 0;
    for (const sql of statements) {
        try {
            await pool.query(sql);
            applied++;
        } catch (e) {
            // Tabla base aún no creada: no abortar el resto
            if (e.code === '42P01') {
                console.warn('[imSchema] Tabla aún no existe, se omite:', sql.slice(0, 60));
                continue;
            }
            // uuid_generate_v4 sin extensión
            if (e.message && e.message.includes('uuid_generate_v4')) {
                try {
                    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
                    await pool.query(sql);
                    applied++;
                    continue;
                } catch (e2) {
                    console.warn('[imSchema] Falló tras crear extensión:', e2.message);
                    continue;
                }
            }
            console.warn('[imSchema] Aviso:', e.code || '', e.message || String(e), '|', sql.slice(0, 80));
        }
    }
    console.log(`[imSchema] Esquema IM verificado (${applied}/${statements.length} sentencias OK).`);
}

module.exports = { ensureImSchema };
