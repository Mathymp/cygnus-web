const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger'); // Importamos logger

const propertiesController = {
    
    // --- 1. LISTAR PROPIEDADES (DASHBOARD) ---
    getAllProperties: async (req, res) => {
        try {
            // 1. Traemos TODAS las propiedades ordenadas por fecha (más nuevas primero)
            let query = supabase
                .from('properties')
                .select(`*, agent:users ( name, id )`)
                .order('created_at', { ascending: false });

            // NOTA: Quitamos el filtro estricto de agente para cumplir con:
            // "listar primero las mías y luego las de otros".
            // Si quisieras que el agente NO vea las de otros, descomenta esto:
            /*
            if (req.session.user.role !== 'admin') {
                query = query.eq('agent_id', req.session.user.id);
            }
            */

            const { data: properties, error } = await query;

            if (error) {
                console.error("Error SQL Propiedades:", error.message);
                throw error;
            }

            // 2. ORDENAMIENTO PERSONALIZADO (Lógica solicitada)
            // Primero las del usuario logueado, luego el resto.
            // Dentro de cada grupo, se respeta el orden de fecha (que ya viene de la BD).
            const userId = req.session.user.id;
            
            if (properties && properties.length > 0) {
                properties.sort((a, b) => {
                    const aIsMine = a.agent_id === userId;
                    const bIsMine = b.agent_id === userId;

                    if (aIsMine && !bIsMine) return -1; // La mía va antes
                    if (!aIsMine && bIsMine) return 1;  // La del otro va después
                    return 0; // Si ambas son mías o ambas ajenas, mantener orden de fecha
                });
            }

            // 3. Lista de agentes para filtros (Solo Admin ve lista completa para filtrar)
            let agentsList = [];
            // Opcional: Si quieres que todos puedan filtrar por agente, quita el 'if admin'
            const { data: agents } = await supabase
                .from('users')
                .select('id, name')
                .neq('role', 'admin'); 
            agentsList = agents || [];

            res.render('admin/propiedades', { 
                title: 'Inventario de Propiedades', 
                page: 'propiedades', 
                user: req.session.user,
                properties: properties || [], 
                agentsList: agentsList
            });

        } catch (error) {
            console.error("Error cargando inventario:", error);
            res.render('admin/propiedades', {
                title: 'Error de Carga',
                page: 'propiedades',
                user: req.session.user,
                properties: [],
                agentsList: [],
                error: "No se pudo cargar el inventario."
            });
        }
    },

    // --- 2. RENDERIZAR VISTA DE PUBLICAR ---
    renderPublish: async (req, res) => {
        res.render('admin/publish', {
            title: 'Nueva Propiedad',
            page: 'publicar',
            user: req.session.user,
            googleMapsKey: process.env.GOOGLE_MAPS_KEY || 'AIzaSyBeMVmY5lCw_TvvUBr6uZh8VrVlWHrU7lg'
        });
    },

    // --- 3. CREAR PROPIEDAD (CON CARACTERÍSTICAS AMPLIADAS) ---
    createProperty: async (req, res) => {
        try {
            const body = req.body;
            const files = req.files || [];
            const user = req.session.user;

            let finalAgentId = null; 
            // Si es agente, forzamos su ID.
            if (user && user.role !== 'admin') {
                finalAgentId = user.id;
            } else if (user.role === 'admin' && body.assigned_agent_id) {
                // Si es admin y eligió un agente en el form
                finalAgentId = body.assigned_agent_id;
            }
            
            const processedImages = files.map((file, index) => ({
                url: file.path, 
                public_id: file.filename,
                is_cover: index === 0 
            }));

            // --- MAPEO DE CARACTERÍSTICAS (FEATURES) ---
            const features = {
                interior: {
                    amoblado: body.f_amoblado === 'on',
                    hall: body.f_hall === 'on',
                    living_comedor_sep: body.f_living_sep === 'on',
                    cocina_americana: body.f_cocina_americana === 'on',
                    cocina_amoblada: body.f_cocina_amob === 'on',
                    cocina_equipada: body.f_cocina_equip === 'on',
                    encimera_granito: body.f_granito === 'on',
                    encimera_silestone: body.f_silestone === 'on',
                    comedor_diario: body.f_comedor_diario === 'on',
                    loggia: body.f_loggia === 'on',
                    despensa: body.f_despensa === 'on',
                    escritorio: body.f_escritorio === 'on',
                    sala_estar: body.f_sala_estar === 'on',
                    home_cinema: body.f_home_cinema === 'on',
                    bar: body.f_bar === 'on',
                    walkin_closet: body.f_walkin === 'on',
                    closet_ropa_blanca: body.f_closet_ropa === 'on',
                    jacuzzi: body.f_jacuzzi === 'on',
                    chimenea: body.f_chimenea === 'on',
                    bosca: body.f_bosca === 'on',
                    calefaccion_central: body.f_calefaccion === 'on',
                    losa_radiante: body.f_losa === 'on',
                    radiadores: body.f_radiadores === 'on',
                    aire_acond: body.f_aire === 'on',
                    alarma_int: body.f_alarma === 'on',
                    citofono: body.f_citofono === 'on',
                    domotica: body.f_domotica === 'on',
                    cerradura_digital: body.f_cerradura_dig === 'on',
                    termopanel: body.f_termopanel === 'on',
                    ventanas_pvc: body.f_ventanas_pvc === 'on',
                    ventanas_aluminio: body.f_ventanas_alu === 'on',
                    mansarda: body.f_mansarda === 'on',
                    subterraneo: body.f_subterraneo === 'on',
                    pieza_servicio: body.f_pieza_serv === 'on',
                    bano_visita: body.f_bano_visita === 'on'
                },
                pisos: {
                    madera: body.f_pisos_madera === 'on',
                    flotante: body.f_pisos_flotante === 'on',
                    porcelanato: body.f_pisos_porcelanato === 'on',
                    alfombra: body.f_pisos_alfombra === 'on',
                    ceramica: body.f_pisos_ceramica === 'on',
                    marmol: body.f_pisos_marmol === 'on',
                    parquet: body.f_pisos_parquet === 'on',
                    piso_vinilico: body.f_pisos_vinilico === 'on'
                },
                exterior: {
                    piscina: body.f_piscina === 'on',
                    piscina_temp: body.f_piscina_temp === 'on',
                    jardin: body.f_jardin === 'on',
                    terraza: body.f_terraza === 'on',
                    terraza_techada: body.f_terraza_tech === 'on',
                    quincho: body.f_quincho === 'on',
                    fogion: body.f_fogion === 'on',
                    riego: body.f_riego === 'on',
                    porton_aut: body.f_porton === 'on',
                    cerco_electrico: body.f_cerco === 'on',
                    antejardin: body.f_antejardin === 'on',
                    patio_servicio: body.f_patio_serv === 'on',
                    estac_techado: body.f_estac_techado === 'on',
                    estac_visitas: body.f_estac_visitas === 'on',
                    bodega_jardin: body.f_bodega_jardin === 'on',
                    canil: body.f_canil === 'on'
                },
                comunidad_seguridad: {
                    condominio_cerrado: body.f_condominio === 'on',
                    acceso_controlado: body.f_acceso === 'on',
                    conserje_247: body.f_conserje_247 === 'on',
                    conserje_diurno: body.f_conserje_diurno === 'on',
                    conserje_nocturno: body.f_conserje_nocturno === 'on',
                    mayordomo: body.f_mayordomo === 'on',
                    rondas_vigilancia: body.f_rondas === 'on',
                    cctv: body.f_cctv === 'on',
                    cerco_perimetral: body.f_cerco_perim === 'on',
                    alarma_comunitaria: body.f_alarma_com === 'on',
                    citofonia_porteria: body.f_citofonia_port === 'on',
                    acceso_biometrico: body.f_biometrico === 'on'
                },
                deportes_recreacion: {
                    club_house: body.f_club_house === 'on',
                    sala_eventos: body.f_eventos === 'on',
                    sala_juegos: body.f_sala_juegos === 'on',
                    gimnasio: body.f_gym === 'on',
                    piscina_comun: body.f_piscina_comun === 'on',
                    cancha_tenis: body.f_tenis === 'on',
                    cancha_padel: body.f_padel === 'on',
                    cancha_futbol: body.f_futbol === 'on',
                    multicancha: body.f_multicancha === 'on',
                    cancha_golf: body.f_golf === 'on',
                    cancha_squash: body.f_squash === 'on',
                    sauna: body.f_sauna === 'on',
                    spa: body.f_spa === 'on',
                    juegos_infantiles: body.f_juegos === 'on',
                    areas_verdes: body.f_areas_verdes === 'on',
                    bicicletero: body.f_bicicletero === 'on',
                    marina: body.f_marina === 'on',
                    acceso_playa: body.f_acceso_playa === 'on'
                },
                servicios_comunidad: {
                    ascensor: body.f_ascensor === 'on',
                    lavanderia: body.f_lavanderia === 'on',
                    business_center: body.f_business === 'on',
                    cowork: body.f_cowork === 'on',
                    cine: body.f_cine === 'on',
                    gourmet: body.f_gourmet === 'on',
                    electrogeno: body.f_electrogeno === 'on',
                    paneles_solares: body.f_paneles === 'on',
                    carga_auto: body.f_carga_auto === 'on',
                    reciclaje: body.f_reciclaje === 'on',
                    estac_visitas_comun: body.f_estac_visitas_com === 'on'
                },
                industrial_comercial: {
                    trifasica: body.f_trifasica === 'on',
                    monofasica: body.f_monofasica === 'on',
                    generador_ind: body.f_generador_ind === 'on',
                    red_incendio: body.f_red_incendio === 'on',
                    sprinklers: body.f_sprinklers === 'on',
                    anden_carga: body.f_anden === 'on',
                    rampa: body.f_rampa === 'on',
                    entrada_camiones: body.f_entrada_camiones === 'on',
                    acceso_camiones: body.f_acceso_camiones === 'on',
                    puente_grua: body.f_grua === 'on',
                    galpon: body.f_galpon === 'on',
                    piso_alto_tonelaje: body.f_piso_tonelaje === 'on',
                    oficinas_plantas: body.f_oficinas_ind === 'on',
                    casino: body.f_casino === 'on',
                    camarines: body.f_camarines === 'on',
                    altura_hombro_6m: body.f_altura_6m === 'on'
                },
                agricola: {
                    rol_propio: body.f_rol_propio === 'on',
                    acciones_derechos: body.f_acciones_derechos === 'on',
                    subdivision_aprobada: body.f_subdivision === 'on',
                    recepcion_final: body.f_recepcion_final === 'on',
                    factibilidad_luz: body.f_fact_luz === 'on',
                    luz_red: body.f_luz_red === 'on',
                    factibilidad_agua: body.f_fact_agua === 'on',
                    apr: body.f_apr === 'on',
                    fibra_optica: body.f_fibra === 'on',
                    senal_4g: body.f_senal_4g === 'on',

                    derechos_agua: body.f_derechos_agua === 'on',
                    acciones_canal: body.f_acciones_canal === 'on',
                    pozo: body.f_pozo === 'on',
                    noria: body.f_noria === 'on',
                    vertiente: body.f_vertiente === 'on',
                    orilla_rio: body.f_orilla_rio === 'on',
                    orilla_lago: body.f_orilla_lago === 'on',
                    estanque: body.f_estanque === 'on',
                    sala_bombas: body.f_sala_bombas === 'on',
                    riego_tecnificado: body.f_riego_tec === 'on',

                    topografia_plana: body.f_topo_plana === 'on',
                    topografia_pendiente: body.f_topo_pendiente === 'on',
                    camino_asfaltado: body.f_camino_asfaltado === 'on',
                    camino_tierra: body.f_camino_tierra === 'on',
                    servidumbre_paso: body.f_camino_servidumbre === 'on',
                    cercado: body.f_cercado === 'on',
                    porton_acceso: body.f_porton_acceso === 'on',
                    bosque_nativo: body.f_bosque_nativo === 'on',
                    plantacion_eucaliptus: body.f_eucaliptus === 'on',
                    plantacion_pinos: body.f_pinos === 'on',
                    arboles_frutales: body.f_frutales === 'on',
                    apto_cultivo: body.f_apto_cultivo === 'on',
                    vista_volcan: body.f_vista_volcan === 'on',
                    vista_valle: body.f_vista_valle === 'on',
                    casa_cuidador: body.f_casa_cuidador === 'on'
                }
            };

            const cleanPrice = (val) => parseFloat((val || '0').toString().replace(/\./g, ''));
            
            const newProperty = {
                title: body.titulo, 
                description: body.descripcion,
                
                operation_type: body.operacion,
                category: body.categoria,
                
                address_display: body.direccion_display,
                address_street: body.calle,
                address_number: body.numero,
                address_unit: body.unidad,
                address_commune: body.comuna,
                address_region: body.region,
                latitude: parseFloat(body.lat) || 0,
                longitude: parseFloat(body.lng) || 0,
                show_exact_address: body.ocultar_mapa !== 'on',

                surface_total: parseFloat(body.m2_total) || 0,
                surface_util: parseFloat(body.m2_util) || 0,
                surface_terrace: parseFloat(body.m2_terraza) || 0,
                
                bedrooms: parseInt(body.dormitorios) || 0,
                bathrooms: parseInt(body.banos) || 0,
                parking: parseInt(body.estacionamientos) || 0,
                storage_units: parseInt(body.bodegas) || 0,
                
                condition: body.condicion, 
                property_age: parseInt(body.antiguedad) || 0,
                orientation: body.orientacion,
                
                currency: body.moneda, 
                price: cleanPrice(body.precio), 
                common_expenses: cleanPrice(body.gastos_comunes),
                contributions: cleanPrice(body.contribuciones),

                features: features,
                images: processedImages,
                
                status: 'publicado',
                agent_id: finalAgentId,
                created_at: new Date()
            };

            const { data, error } = await supabase
                .from('properties')
                .insert([newProperty])
                .select();

            if (error) {
                console.error("❌ Error Supabase:", error);
                if (error.code === 'PGRST204' || (error.message && error.message.includes('column'))) {
                    throw new Error("Faltan columnas en la base de datos.");
                }
                if (error.code === '23503') {
                    throw new Error("Error de usuario: El sistema intentó asignar un agente que no existe.");
                }
                throw new Error("No se pudo guardar la propiedad. Verifica tu conexión.");
            }

            // --- REGISTRAR ACTIVIDAD (CREATE) ---
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                'create',
                'propiedad',
                `Publicó nueva propiedad: ${body.titulo}`
            );

            res.json({ success: true, id: data[0].id });

        } catch (error) {
            console.error('Error Fatal Publicar:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    // --- 4. RENDERIZAR EDITAR (BLINDADO) ---
    renderEdit: async (req, res) => {
        try {
            const { id } = req.params;
            const user = req.session.user; 

            if (!id || id.length < 5) return res.status(404).send("ID no válido");

            // Traemos también al agente para que la vista no falle
            const { data: prop, error } = await supabase
                .from('properties')
                .select('*, agent:users ( name, id )') 
                .eq('id', id)
                .single();

            if (error || !prop) {
                return res.render('admin/propiedades', {
                    title: 'Inventario',
                    page: 'propiedades',
                    user: req.session.user,
                    properties: [],
                    agentsList: [],
                    error: "La propiedad solicitada no existe o fue eliminada."
                });
            }

            // --- SEGURIDAD: VERIFICAR SI ES DUEÑO O ADMIN ---
            if (user.role !== 'admin' && prop.agent_id !== user.id) {
                // Si intenta editar por URL directa, lo devolvemos
                return res.redirect('/admin/propiedades');
            }

            res.render('admin/edit-property', {
                title: `Editar: ${prop.title}`,
                page: 'propiedades',
                user: req.session.user,
                prop: prop,
                googleMapsKey: process.env.GOOGLE_MAPS_KEY || 'AIzaSyBeMVmY5lCw_TvvUBr6uZh8VrVlWHrU7lg'
            });

        } catch (error) {
            console.error(error);
            res.redirect('/admin/propiedades');
        }
    },

    // --- 5. ACTUALIZAR PROPIEDAD (CON LOS MISMOS CAMPOS NUEVOS) ---
    updateProperty: async (req, res) => {
        try {
            const { id } = req.params;
            const body = req.body;
            const newFiles = req.files || [];
            const user = req.session.user;

            // --- SEGURIDAD: VERIFICAR DUEÑO ANTES DE ACTUALIZAR ---
            if (user.role !== 'admin') {
                const { data: propCheck } = await supabase.from('properties').select('agent_id').eq('id', id).single();
                if (!propCheck || propCheck.agent_id !== user.id) {
                    return res.status(403).json({ success: false, message: "No autorizado para editar esta propiedad." });
                }
            }

            // 1. MANEJO DE IMÁGENES
            let finalImages = [];
            
            if (body.kept_images) {
                try {
                    finalImages = JSON.parse(body.kept_images);
                } catch (e) { console.error("Error parseando imagenes kept", e); }
            }

            const newImagesProcessed = newFiles.map(file => ({
                url: file.path, 
                public_id: file.filename,
                is_cover: false 
            }));

            finalImages = [...finalImages, ...newImagesProcessed];
            if (finalImages.length > 0) finalImages.forEach((img, idx) => img.is_cover = (idx === 0));

            // 2. FEATURES MASIVOS
            const features = {
                interior: {
                    amoblado: body.f_amoblado === 'on',
                    hall: body.f_hall === 'on',
                    living_comedor_sep: body.f_living_sep === 'on',
                    cocina_americana: body.f_cocina_americana === 'on',
                    cocina_amoblada: body.f_cocina_amob === 'on',
                    cocina_equipada: body.f_cocina_equip === 'on',
                    encimera_granito: body.f_granito === 'on',
                    encimera_silestone: body.f_silestone === 'on',
                    comedor_diario: body.f_comedor_diario === 'on',
                    loggia: body.f_loggia === 'on',
                    despensa: body.f_despensa === 'on',
                    escritorio: body.f_escritorio === 'on',
                    sala_estar: body.f_sala_estar === 'on',
                    home_cinema: body.f_home_cinema === 'on',
                    bar: body.f_bar === 'on',
                    walkin_closet: body.f_walkin === 'on',
                    closet_ropa_blanca: body.f_closet_ropa === 'on',
                    jacuzzi: body.f_jacuzzi === 'on',
                    chimenea: body.f_chimenea === 'on',
                    bosca: body.f_bosca === 'on',
                    calefaccion_central: body.f_calefaccion === 'on',
                    losa_radiante: body.f_losa === 'on',
                    radiadores: body.f_radiadores === 'on',
                    aire_acond: body.f_aire === 'on',
                    alarma_int: body.f_alarma === 'on',
                    citofono: body.f_citofono === 'on',
                    domotica: body.f_domotica === 'on',
                    cerradura_digital: body.f_cerradura_dig === 'on',
                    termopanel: body.f_termopanel === 'on',
                    ventanas_pvc: body.f_ventanas_pvc === 'on',
                    ventanas_aluminio: body.f_ventanas_alu === 'on',
                    mansarda: body.f_mansarda === 'on',
                    subterraneo: body.f_subterraneo === 'on',
                    pieza_servicio: body.f_pieza_serv === 'on',
                    bano_visita: body.f_bano_visita === 'on'
                },
                pisos: {
                    madera: body.f_pisos_madera === 'on',
                    flotante: body.f_pisos_flotante === 'on',
                    porcelanato: body.f_pisos_porcelanato === 'on',
                    alfombra: body.f_pisos_alfombra === 'on',
                    ceramica: body.f_pisos_ceramica === 'on',
                    marmol: body.f_pisos_marmol === 'on',
                    parquet: body.f_pisos_parquet === 'on',
                    piso_vinilico: body.f_pisos_vinilico === 'on'
                },
                exterior: {
                    piscina: body.f_piscina === 'on',
                    piscina_temp: body.f_piscina_temp === 'on',
                    jardin: body.f_jardin === 'on',
                    terraza: body.f_terraza === 'on',
                    terraza_techada: body.f_terraza_tech === 'on',
                    quincho: body.f_quincho === 'on',
                    fogion: body.f_fogion === 'on',
                    riego: body.f_riego === 'on',
                    porton_aut: body.f_porton === 'on',
                    cerco_electrico: body.f_cerco === 'on',
                    antejardin: body.f_antejardin === 'on',
                    patio_servicio: body.f_patio_serv === 'on',
                    estac_techado: body.f_estac_techado === 'on',
                    estac_visitas: body.f_estac_visitas === 'on',
                    bodega_jardin: body.f_bodega_jardin === 'on',
                    canil: body.f_canil === 'on'
                },
                comunidad_seguridad: {
                    condominio_cerrado: body.f_condominio === 'on',
                    acceso_controlado: body.f_acceso === 'on',
                    conserje_247: body.f_conserje_247 === 'on',
                    conserje_diurno: body.f_conserje_diurno === 'on',
                    conserje_nocturno: body.f_conserje_nocturno === 'on',
                    mayordomo: body.f_mayordomo === 'on',
                    rondas_vigilancia: body.f_rondas === 'on',
                    cctv: body.f_cctv === 'on',
                    cerco_perimetral: body.f_cerco_perim === 'on',
                    alarma_comunitaria: body.f_alarma_com === 'on',
                    citofonia_porteria: body.f_citofonia_port === 'on',
                    acceso_biometrico: body.f_biometrico === 'on'
                },
                deportes_recreacion: {
                    club_house: body.f_club_house === 'on',
                    sala_eventos: body.f_eventos === 'on',
                    sala_juegos: body.f_sala_juegos === 'on',
                    gimnasio: body.f_gym === 'on',
                    piscina_comun: body.f_piscina_comun === 'on',
                    cancha_tenis: body.f_tenis === 'on',
                    cancha_padel: body.f_padel === 'on',
                    cancha_futbol: body.f_futbol === 'on',
                    multicancha: body.f_multicancha === 'on',
                    cancha_golf: body.f_golf === 'on',
                    cancha_squash: body.f_squash === 'on',
                    sauna: body.f_sauna === 'on',
                    spa: body.f_spa === 'on',
                    juegos_infantiles: body.f_juegos === 'on',
                    areas_verdes: body.f_areas_verdes === 'on',
                    bicicletero: body.f_bicicletero === 'on',
                    marina: body.f_marina === 'on',
                    acceso_playa: body.f_acceso_playa === 'on'
                },
                servicios_comunidad: {
                    ascensor: body.f_ascensor === 'on',
                    lavanderia: body.f_lavanderia === 'on',
                    business_center: body.f_business === 'on',
                    cowork: body.f_cowork === 'on',
                    cine: body.f_cine === 'on',
                    gourmet: body.f_gourmet === 'on',
                    electrogeno: body.f_electrogeno === 'on',
                    paneles_solares: body.f_paneles === 'on',
                    carga_auto: body.f_carga_auto === 'on',
                    reciclaje: body.f_reciclaje === 'on',
                    estac_visitas_comun: body.f_estac_visitas_com === 'on'
                },
                industrial_comercial: {
                    trifasica: body.f_trifasica === 'on',
                    monofasica: body.f_monofasica === 'on',
                    generador_ind: body.f_generador_ind === 'on',
                    red_incendio: body.f_red_incendio === 'on',
                    sprinklers: body.f_sprinklers === 'on',
                    anden_carga: body.f_anden === 'on',
                    rampa: body.f_rampa === 'on',
                    entrada_camiones: body.f_entrada_camiones === 'on',
                    acceso_camiones: body.f_acceso_camiones === 'on',
                    puente_grua: body.f_grua === 'on',
                    galpon: body.f_galpon === 'on',
                    piso_alto_tonelaje: body.f_piso_tonelaje === 'on',
                    oficinas_plantas: body.f_oficinas_ind === 'on',
                    casino: body.f_casino === 'on',
                    camarines: body.f_camarines === 'on',
                    altura_hombro_6m: body.f_altura_6m === 'on'
                },
                agricola: {
                    rol_propio: body.f_rol_propio === 'on',
                    acciones_derechos: body.f_acciones_derechos === 'on',
                    subdivision_aprobada: body.f_subdivision === 'on',
                    recepcion_final: body.f_recepcion_final === 'on',
                    factibilidad_luz: body.f_fact_luz === 'on',
                    luz_red: body.f_luz_red === 'on',
                    factibilidad_agua: body.f_fact_agua === 'on',
                    apr: body.f_apr === 'on',
                    fibra_optica: body.f_fibra === 'on',
                    senal_4g: body.f_senal_4g === 'on',

                    derechos_agua: body.f_derechos_agua === 'on',
                    acciones_canal: body.f_acciones_canal === 'on',
                    pozo: body.f_pozo === 'on',
                    noria: body.f_noria === 'on',
                    vertiente: body.f_vertiente === 'on',
                    orilla_rio: body.f_orilla_rio === 'on',
                    orilla_lago: body.f_orilla_lago === 'on',
                    estanque: body.f_estanque === 'on',
                    sala_bombas: body.f_sala_bombas === 'on',
                    riego_tecnificado: body.f_riego_tec === 'on',

                    topografia_plana: body.f_topo_plana === 'on',
                    topografia_pendiente: body.f_topo_pendiente === 'on',
                    camino_asfaltado: body.f_camino_asfaltado === 'on',
                    camino_tierra: body.f_camino_tierra === 'on',
                    servidumbre_paso: body.f_camino_servidumbre === 'on',
                    cercado: body.f_cercado === 'on',
                    porton_acceso: body.f_porton_acceso === 'on',
                    bosque_nativo: body.f_bosque_nativo === 'on',
                    plantacion_eucaliptus: body.f_eucaliptus === 'on',
                    plantacion_pinos: body.f_pinos === 'on',
                    arboles_frutales: body.f_frutales === 'on',
                    apto_cultivo: body.f_apto_cultivo === 'on',
                    vista_volcan: body.f_vista_volcan === 'on',
                    vista_valle: body.f_vista_valle === 'on',
                    casa_cuidador: body.f_casa_cuidador === 'on'
                }
            };

            const cleanPrice = (val) => parseFloat((val || '0').toString().replace(/\./g, ''));

            const updates = {
                title: body.titulo, 
                description: body.descripcion,
                
                operation_type: body.operacion,
                category: body.categoria,
                
                address_display: body.direccion_display,
                address_street: body.calle,
                address_number: body.numero,
                address_unit: body.unidad,
                address_commune: body.comuna,
                address_region: body.region,
                latitude: parseFloat(body.lat) || 0,
                longitude: parseFloat(body.lng) || 0,
                show_exact_address: body.ocultar_mapa !== 'on',

                surface_total: parseFloat(body.m2_total) || 0,
                surface_util: parseFloat(body.m2_util) || 0,
                surface_terrace: parseFloat(body.m2_terraza) || 0,
                
                bedrooms: parseInt(body.dormitorios) || 0,
                bathrooms: parseInt(body.banos) || 0,
                parking: parseInt(body.estacionamientos) || 0,
                storage_units: parseInt(body.bodegas) || 0,
                
                condition: body.condicion, 
                property_age: parseInt(body.antiguedad) || 0,
                orientation: body.orientacion,
                
                currency: body.moneda, 
                price: cleanPrice(body.precio), 
                common_expenses: cleanPrice(body.gastos_comunes),
                contributions: cleanPrice(body.contribuciones),

                features: features,
                images: finalImages, 
                updated_at: new Date()
            };

            const { error } = await supabase
                .from('properties')
                .update(updates)
                .eq('id', id);

            if (error) throw error;

            // --- REGISTRAR ACTIVIDAD (UPDATE) ---
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                'update',
                'propiedad',
                `Actualizó propiedad: ${body.titulo}`
            );

            res.redirect('/admin/propiedades');

        } catch (error) {
            console.error("Error actualizando:", error);
            res.redirect('/admin/propiedades');
        }
    },

    // --- 6. CAMBIAR ESTADO ---
    changeStatus: async (req, res) => {
        try {
            const { propertyId, status } = req.body;
            const user = req.session.user;

            // --- SEGURIDAD: VERIFICAR DUEÑO ANTES DE CAMBIAR ESTADO ---
            if (user.role !== 'admin') {
                const { data: propCheck } = await supabase.from('properties').select('agent_id').eq('id', propertyId).single();
                if (!propCheck || propCheck.agent_id !== user.id) {
                    return res.status(403).json({ success: false, message: "No autorizado." });
                }
            }

            let dbStatus = status;
            if(status === 'pausado') dbStatus = 'borrador'; 

            const { error } = await supabase
                .from('properties')
                .update({ status: dbStatus })
                .eq('id', propertyId);
            
            if (error) throw error;

            // --- REGISTRAR ACTIVIDAD (STATUS CHANGE) ---
            let action = 'update';
            if(dbStatus === 'vendido' || dbStatus === 'arrendado') action = 'sold';
            
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                action,
                'estado',
                `Cambió estado a ${dbStatus} (ID: ${propertyId})`
            );

            res.json({ success: true, newStatus: dbStatus });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    },

    // --- 7. ELIMINAR ---
    deleteProperty: async (req, res) => {
        try {
            const { id } = req.params;
            const user = req.session.user;

            // --- SEGURIDAD: VERIFICAR DUEÑO ANTES DE BORRAR ---
            if (user.role !== 'admin') {
                const { data: propCheck } = await supabase.from('properties').select('agent_id').eq('id', id).single();
                if (!propCheck || propCheck.agent_id !== user.id) {
                    return res.status(403).json({ success: false, message: "No autorizado para eliminar esta propiedad." });
                }
            }

            const { error } = await supabase
                .from('properties')
                .delete()
                .eq('id', id);
                
            if (error) throw error;

            // --- REGISTRAR ACTIVIDAD (DELETE) ---
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                'delete',
                'propiedad',
                `Eliminó propiedad ID: ${id}`
            );

            res.json({ success: true });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    },

    // --- 8. REASIGNAR ---
    reassignAgent: async (req, res) => {
        try {
            const { propertyId, newAgentId } = req.body;
            
            // Seguridad: Solo admin puede reasignar
            if (req.session.user.role !== 'admin') {
                return res.redirect('/admin/propiedades');
            }

            const { error } = await supabase
                .from('properties')
                .update({ agent_id: newAgentId })
                .eq('id', propertyId);

            if (error) throw error;

            // --- REGISTRAR ACTIVIDAD (REASSIGN) ---
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                'update',
                'asignacion',
                `Reasignó propiedad ${propertyId} a otro agente`
            );

            res.redirect('/admin/propiedades');
        } catch (e) {
            console.error(e);
            res.redirect('/admin/propiedades');
        }
    }
};

module.exports = propertiesController;