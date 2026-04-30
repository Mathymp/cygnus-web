const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config();

// Para panoramas usamos service_role key que bypasea RLS (operación server-side)
// Si no tienes SUPABASE_SERVICE_KEY en .env, ejecuta en Supabase SQL Editor:
// ALTER TABLE panoramas_360 DISABLE ROW LEVEL SECURITY;
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

// Cloudinary para eliminar imágenes (la config ya fue cargada por cloudinaryConfig.js)
const cloudinary = require('cloudinary').v2;

const SQL_CREATE_TABLE = `
-- Ejecuta esto en Supabase SQL Editor si no existe la tabla:
CREATE TABLE IF NOT EXISTS panoramas_360 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    public_id TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    public_token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const panoramasController = {

    adminPanel: async (req, res) => {
        try {
            const { data: panoramas, error } = await supabase
                .from('panoramas_360')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.warn('⚠️  Error tabla panoramas_360. SQL para crear:', SQL_CREATE_TABLE);
            }

            res.render('admin/panoramas360', {
                title: 'Visor 360 | Cygnus Admin',
                user: req.session.user,
                page: 'pano360',
                panoramas: panoramas || []
            });
        } catch (e) {
            console.error('panoramas adminPanel:', e);
            res.render('admin/panoramas360', {
                title: 'Visor 360 | Cygnus Admin',
                user: req.session.user,
                page: 'pano360',
                panoramas: []
            });
        }
    },

    editorPage: async (req, res) => {
        try {
            const { id } = req.params;
            let panorama = null;

            if (id !== 'nuevo') {
                const { data } = await supabase
                    .from('panoramas_360')
                    .select('*')
                    .eq('id', id)
                    .single();
                panorama = data || null;
            }

            res.render('admin/editor360', {
                title: panorama ? `Editando: ${panorama.name}` : 'Nuevo Panorama 360',
                user: req.session.user,
                page: 'pano360',
                panorama: panorama,
                baseUrl: req.protocol + '://' + req.get('host')
            });
        } catch (e) {
            console.error('panoramas editorPage:', e);
            res.redirect('/admin/360');
        }
    },

    savePanorama: async (req, res) => {
        try {
            const { name, settings_json, panorama_id, existing_image_url, existing_public_id } = req.body;
            const file = req.file;

            // multer-storage-cloudinary ya subió el archivo; path = secure_url, filename = public_id
            let imageUrl = file ? file.path : (existing_image_url || null);
            let publicId  = file ? file.filename : (existing_public_id || null);

            if (!imageUrl) {
                return res.json({ success: false, error: 'Se requiere una imagen panorámica.' });
            }

            let settings = {};
            try { settings = JSON.parse(settings_json || '{}'); } catch (_) {}

            const record = {
                name: (name || 'Panorama sin nombre').trim(),
                image_url: imageUrl,
                public_id: publicId,
                settings,
                updated_at: new Date()
            };

            let saved;

            if (panorama_id) {
                const { data, error } = await supabase
                    .from('panoramas_360')
                    .update(record)
                    .eq('id', panorama_id)
                    .select()
                    .single();
                if (error) throw error;
                saved = data;
            } else {
                // Generar slug público único: nombre-normalizado + hex random
                const slug = (name || 'panorama')
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 40)
                    + '-' + crypto.randomBytes(4).toString('hex');

                const { data, error } = await supabase
                    .from('panoramas_360')
                    .insert({ ...record, public_token: slug })
                    .select()
                    .single();
                if (error) throw error;
                saved = data;
            }

            res.json({ success: true, panorama: saved });
        } catch (e) {
            console.error('panoramas savePanorama:', e);
            res.json({ success: false, error: e.message });
        }
    },

    deletePanorama: async (req, res) => {
        try {
            const { id } = req.params;

            // 1. Obtener public_id antes de borrar
            const { data: pano } = await supabase
                .from('panoramas_360')
                .select('public_id, name')
                .eq('id', id)
                .single();

            // 2. Eliminar de Cloudinary si tiene public_id
            if (pano && pano.public_id) {
                try {
                    const result = await cloudinary.uploader.destroy(pano.public_id, { invalidate: true });
                    console.log(`Cloudinary delete "${pano.name}":`, result.result);
                } catch (cdnErr) {
                    console.warn('Advertencia Cloudinary delete:', cdnErr.message);
                }
            }

            // 3. Eliminar de Supabase
            const { error } = await supabase.from('panoramas_360').delete().eq('id', id);
            if (error) throw error;

            res.json({ success: true });
        } catch (e) {
            console.error('deletePanorama:', e);
            res.json({ success: false, error: e.message });
        }
    },

    publicViewer: async (req, res) => {
        try {
            const { slug } = req.params;
            const { data: panorama } = await supabase
                .from('panoramas_360')
                .select('*')
                .eq('public_token', slug)
                .single();

            if (!panorama) {
                return res.status(404).render('index', {
                    title: 'Vista no encontrada | Cygnus Group',
                    activePage: 'home',
                    properties: [],
                    filters: {},
                    config: {}
                });
            }

            res.render('panorama-viewer', {
                title: panorama.name + ' | Vista 360 — Cygnus Group',
                panorama
            });
        } catch (e) {
            console.error('panoramas publicViewer:', e);
            res.redirect('/');
        }
    }
};

module.exports = panoramasController;
