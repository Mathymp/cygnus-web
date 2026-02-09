const supabase = require('../config/supabaseClient');
const logActivity = require('../helpers/logger'); // Importamos logger para registrar cambios

const editPropertyController = {

    // --- RENDERIZAR VISTA DE EDICIÓN ---
    renderEdit: async (req, res) => {
        try {
            const { id } = req.params;
            const user = req.session.user;

            // Validación básica de ID
            if (!id || id.length < 5) {
                return res.redirect('/admin/propiedades');
            }

            // CORRECCIÓN CLAVE: Traemos también los datos del agente (agent:users)
            // Esto evita el error "agent is undefined" cuando el admin edita propiedades ajenas.
            const { data: prop, error } = await supabase
                .from('properties')
                .select('*, agent:users ( name, id, email )')
                .eq('id', id)
                .single();

            if (error || !prop) {
                console.error("Propiedad no encontrada:", error?.message);
                return res.redirect('/admin/propiedades');
            }

            // SEGURIDAD: Validación de Permisos
            // Si NO es admin Y la propiedad NO es suya -> Lo expulsamos
            if (user.role !== 'admin' && prop.agent_id !== user.id) {
                console.error(`Acceso denegado: Agente ${user.name} intentó editar propiedad de otro.`);
                return res.redirect('/admin/propiedades');
            }

            // Renderizamos la vista
            res.render('admin/edit-property', {
                title: `Editar Propiedad`,
                page: 'propiedades',
                user: user,
                prop: prop,
                googleMapsKey: process.env.GOOGLE_MAPS_KEY || 'AIzaSyBeMVmY5lCw_TvvUBr6uZh8VrVlWHrU7lg'
            });

        } catch (error) {
            console.error("Error renderEdit:", error);
            res.redirect('/admin/propiedades');
        }
    },

    // --- PROCESAR ACTUALIZACIÓN (Respuesta JSON para AJAX) ---
    updateProperty: async (req, res) => {
        try {
            const { id } = req.params;
            const body = req.body;
            const newFiles = req.files || [];
            const user = req.session.user;

            // 1. SEGURIDAD PREVIA: Verificar permisos antes de guardar
            // Buscamos quién es el dueño actual de la propiedad en la BD
            const { data: existingProp, error: findError } = await supabase
                .from('properties')
                .select('agent_id, title')
                .eq('id', id)
                .single();

            if (findError || !existingProp) {
                return res.status(404).json({ success: false, message: "Propiedad no encontrada." });
            }

            // Si NO es admin Y intenta editar algo que no es suyo -> Error 403
            if (user.role !== 'admin' && existingProp.agent_id !== user.id) {
                return res.status(403).json({ success: false, message: "No tienes permiso para editar esta propiedad." });
            }

            // 2. MANEJO DE IMÁGENES
            let finalImages = [];
            
            // a) Imágenes antiguas conservadas
            if (body.kept_images) {
                try {
                    finalImages = JSON.parse(body.kept_images);
                } catch (e) {
                    console.error("Error parseando kept_images", e);
                }
            }

            // b) Procesar nuevas imágenes subidas
            const newImagesProcessed = newFiles.map((file) => ({
                url: file.path, 
                public_id: file.filename,
                is_cover: false 
            }));

            // c) Unir y ordenar
            finalImages = [...finalImages, ...newImagesProcessed];

            // d) Asegurar Portada
            if (finalImages.length > 0) {
                finalImages.forEach(img => img.is_cover = false);
                finalImages[0].is_cover = true;
            }

            // 3. FEATURES (Mapeo idéntico al crear)
            const check = (val) => val === 'on';
            const features = {
                interior: {
                    amoblado: check(body.f_amoblado),
                    hall: check(body.f_hall),
                    living_comedor_sep: check(body.f_living_sep),
                    cocina_americana: check(body.f_cocina_americana),
                    cocina_amoblada: check(body.f_cocina_amob),
                    cocina_equipada: check(body.f_cocina_equip),
                    encimera_granito: check(body.f_granito),
                    encimera_silestone: check(body.f_silestone),
                    comedor_diario: check(body.f_comedor_diario),
                    loggia: check(body.f_loggia),
                    despensa: check(body.f_despensa),
                    escritorio: check(body.f_escritorio),
                    sala_estar: check(body.f_sala_estar),
                    home_cinema: check(body.f_home_cinema),
                    bar: check(body.f_bar),
                    walkin_closet: check(body.f_walkin),
                    closet_ropa_blanca: check(body.f_closet_ropa),
                    jacuzzi: check(body.f_jacuzzi),
                    chimenea: check(body.f_chimenea),
                    bosca: check(body.f_bosca),
                    calefaccion_central: check(body.f_calefaccion),
                    losa_radiante: check(body.f_losa),
                    radiadores: check(body.f_radiadores),
                    aire_acond: check(body.f_aire),
                    alarma_int: check(body.f_alarma),
                    citofono: check(body.f_citofono),
                    domotica: check(body.f_domotica),
                    cerradura_digital: check(body.f_cerradura_dig),
                    termopanel: check(body.f_termopanel),
                    ventanas_pvc: check(body.f_ventanas_pvc),
                    ventanas_aluminio: check(body.f_ventanas_alu),
                    mansarda: check(body.f_mansarda),
                    subterraneo: check(body.f_subterraneo),
                    pieza_servicio: check(body.f_pieza_serv),
                    bano_visita: check(body.f_bano_visita)
                },
                pisos: {
                    madera: check(body.f_pisos_madera),
                    flotante: check(body.f_pisos_flotante),
                    porcelanato: check(body.f_pisos_porcelanato),
                    alfombra: check(body.f_pisos_alfombra),
                    ceramica: check(body.f_pisos_ceramica),
                    marmol: check(body.f_pisos_marmol),
                    parquet: check(body.f_pisos_parquet),
                    piso_vinilico: check(body.f_pisos_vinilico)
                },
                exterior: {
                    piscina: check(body.f_piscina),
                    piscina_temp: check(body.f_piscina_temp),
                    jardin: check(body.f_jardin),
                    terraza: check(body.f_terraza),
                    terraza_techada: check(body.f_terraza_tech),
                    quincho: check(body.f_quincho),
                    fogion: check(body.f_fogion),
                    riego: check(body.f_riego),
                    porton_aut: check(body.f_porton),
                    cerco_electrico: check(body.f_cerco),
                    antejardin: check(body.f_antejardin),
                    patio_servicio: check(body.f_patio_serv),
                    estac_techado: check(body.f_estac_techado),
                    estac_visitas: check(body.f_estac_visitas),
                    bodega_jardin: check(body.f_bodega_jardin),
                    canil: check(body.f_canil)
                },
                comunidad_seguridad: {
                    condominio_cerrado: check(body.f_condominio),
                    acceso_controlado: check(body.f_acceso),
                    conserje_247: check(body.f_conserje_247),
                    conserje_diurno: check(body.f_conserje_diurno),
                    conserje_nocturno: check(body.f_conserje_nocturno),
                    mayordomo: check(body.f_mayordomo),
                    rondas_vigilancia: check(body.f_rondas),
                    cctv: check(body.f_cctv),
                    cerco_perimetral: check(body.f_cerco_perim),
                    alarma_comunitaria: check(body.f_alarma_com),
                    citofonia_porteria: check(body.f_citofonia_port),
                    acceso_biometrico: check(body.f_biometrico)
                },
                deportes_recreacion: {
                    club_house: check(body.f_club_house),
                    sala_eventos: check(body.f_eventos),
                    sala_juegos: check(body.f_sala_juegos),
                    gimnasio: check(body.f_gym),
                    piscina_comun: check(body.f_piscina_comun),
                    cancha_tenis: check(body.f_tenis),
                    cancha_padel: check(body.f_padel),
                    cancha_futbol: check(body.f_futbol),
                    multicancha: check(body.f_multicancha),
                    cancha_golf: check(body.f_golf),
                    cancha_squash: check(body.f_squash),
                    sauna: check(body.f_sauna),
                    spa: check(body.f_spa),
                    juegos_infantiles: check(body.f_juegos),
                    areas_verdes: check(body.f_areas_verdes),
                    bicicletero: check(body.f_bicicletero),
                    marina: check(body.f_marina),
                    acceso_playa: check(body.f_acceso_playa)
                },
                servicios_comunidad: {
                    ascensor: check(body.f_ascensor),
                    lavanderia: check(body.f_lavanderia),
                    business_center: check(body.f_business),
                    cowork: check(body.f_cowork),
                    cine: check(body.f_cine),
                    gourmet: check(body.f_gourmet),
                    electrogeno: check(body.f_electrogeno),
                    paneles_solares: check(body.f_paneles),
                    carga_auto: check(body.f_carga_auto),
                    reciclaje: check(body.f_reciclaje),
                    estac_visitas_comun: check(body.f_estac_visitas_com)
                },
                industrial_comercial: {
                    trifasica: check(body.f_trifasica),
                    monofasica: check(body.f_monofasica),
                    generador_ind: check(body.f_generador_ind),
                    red_incendio: check(body.f_red_incendio),
                    sprinklers: check(body.f_sprinklers),
                    anden_carga: check(body.f_anden),
                    rampa: check(body.f_rampa),
                    entrada_camiones: check(body.f_entrada_camiones),
                    acceso_camiones: check(body.f_acceso_camiones),
                    puente_grua: check(body.f_grua),
                    galpon: check(body.f_galpon),
                    piso_alto_tonelaje: check(body.f_piso_tonelaje),
                    oficinas_plantas: check(body.f_oficinas_ind),
                    casino: check(body.f_casino),
                    camarines: check(body.f_camarines),
                    altura_hombro_6m: check(body.f_altura_6m)
                },
                agricola: {
                    rol_propio: check(body.f_rol_propio),
                    acciones_derechos: check(body.f_acciones_derechos),
                    subdivision_aprobada: check(body.f_subdivision),
                    recepcion_final: check(body.f_recepcion_final),
                    factibilidad_luz: check(body.f_fact_luz),
                    luz_red: check(body.f_luz_red),
                    factibilidad_agua: check(body.f_fact_agua),
                    apr: check(body.f_apr),
                    fibra_optica: check(body.f_fibra),
                    senal_4g: check(body.f_senal_4g),
                    derechos_agua: check(body.f_derechos_agua),
                    acciones_canal: check(body.f_acciones_canal),
                    pozo: check(body.f_pozo),
                    noria: check(body.f_noria),
                    vertiente: check(body.f_vertiente),
                    orilla_rio: check(body.f_orilla_rio),
                    orilla_lago: check(body.f_orilla_lago),
                    estanque: check(body.f_estanque),
                    sala_bombas: check(body.f_sala_bombas),
                    riego_tecnificado: check(body.f_riego_tec),
                    topografia_plana: check(body.f_topo_plana),
                    topografia_pendiente: check(body.f_topo_pendiente),
                    camino_asfaltado: check(body.f_camino_asfaltado),
                    camino_tierra: check(body.f_camino_tierra),
                    servidumbre_paso: check(body.f_camino_servidumbre),
                    cercado: check(body.f_cercado),
                    porton_acceso: check(body.f_porton_acceso),
                    bosque_nativo: check(body.f_bosque_nativo),
                    plantacion_eucaliptus: check(body.f_eucaliptus),
                    plantacion_pinos: check(body.f_pinos),
                    arboles_frutales: check(body.f_frutales),
                    apto_cultivo: check(body.f_apto_cultivo),
                    vista_volcan: check(body.f_vista_volcan),
                    vista_valle: check(body.f_vista_valle),
                    casa_cuidador: check(body.f_casa_cuidador)
                }
            };

            const cleanPrice = (val) => {
                if(!val) return 0;
                return parseFloat(val.toString().replace(/\./g, '').replace(/,/g, '.'));
            };

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
                show_exact_address: check(body.ocultar_mapa) ? false : true,

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

            // Log de actividad (Ahora sí lo registramos correctamente)
            await logActivity(
                req.session.user.id,
                req.session.user.name,
                'update',
                'propiedad',
                `Actualizó propiedad: ${body.titulo}`
            );

            res.json({ success: true, id: id });

        } catch (error) {
            console.error("Error actualizando propiedad:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = editPropertyController;