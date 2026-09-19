// functions/api/save-data.js
import bcrypt from 'bcryptjs';
import { authenticateRequest } from './_auth.js';

const isObject = (item) => (item && typeof item === 'object' && !Array.isArray(item));

const deepMerge = (target, source) => {
  let output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) output[key] = source[key];
        else output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
};

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user } = auth;

  try {
    const data = await request.json();

    // 1. Update Shop Settings
    if (data.shopSettings) {
      const currentRes = await env.DB.prepare('SELECT settings_json FROM shop_settings WHERE id = 1').first();
      let currentSettings = {};
      if (currentRes?.settings_json) {
        try {
          currentSettings = JSON.parse(currentRes.settings_json);
        } catch (e) {
          currentSettings = {};
        }
      }

      const newSettings = deepMerge(currentSettings, data.shopSettings);
      await env.DB.prepare('UPDATE shop_settings SET settings_json = ? WHERE id = 1')
        .bind(JSON.stringify(newSettings))
        .run();

      // Product machines sync
      if (Array.isArray(data.shopSettings.productMachines)) {
        const machines = data.shopSettings.productMachines;
        const statements = [];

        statements.push(env.DB.prepare('DELETE FROM product_machines'));
        machines.forEach((m, idx) => {
          const id = String(m.id || `machine_${Date.now()}_${idx}`);
          const nameTh = String(m.name ?? m.name_th ?? '');
          const nameEn = String(m.name_en ?? '');
          const imageUrl = String(m.imageUrl ?? m.image_url ?? '');
          const productIds = JSON.stringify(Array.isArray(m.productIds ?? m.product_ids) ? (m.productIds ?? m.product_ids) : []);
          const sortOrder = Number.isFinite(Number(m.sortOrder ?? m.sort_order)) ? Number(m.sortOrder ?? m.sort_order) : idx;
          const now = new Date().toISOString();

          statements.push(
            env.DB.prepare(
              'INSERT INTO product_machines (id, name_th, name_en, image_url, product_ids, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(id, nameTh, nameEn, imageUrl, productIds, sortOrder, now, now)
          );
        });

        if (statements.length > 0) {
          await env.DB.batch(statements);
        }
      }
    }

    // 2. Sync Sub-Admins (Only Super Admins)
    if (user.isSuperAdmin && data.subAdmins) {
      for (const subAdmin of data.subAdmins) {
        const passwordHash = subAdmin.password ? await bcrypt.hash(subAdmin.password, 10) : null;
        if (subAdmin.id && subAdmin.id > 0) {
          if (passwordHash) {
            await env.DB.prepare(
              'UPDATE users SET username=?, name=?, pin_hash=?, permissions=? WHERE id=?'
            ).bind(subAdmin.username, subAdmin.name, passwordHash, JSON.stringify(subAdmin.permissions || {}), subAdmin.id).run();
          } else {
            await env.DB.prepare(
              'UPDATE users SET username=?, name=?, permissions=? WHERE id=?'
            ).bind(subAdmin.username, subAdmin.name, JSON.stringify(subAdmin.permissions || {}), subAdmin.id).run();
          }
        } else {
          const maxIdRes = await env.DB.prepare('SELECT MAX(id) as max_id FROM users').first();
          const newUserId = (maxIdRes?.max_id || 0) + 1;
          await env.DB.prepare(
            'INSERT INTO users (id, username, name, pin_hash, is_super_admin, permissions) VALUES (?, ?, ?, ?, 0, ?)'
          ).bind(newUserId, subAdmin.username, subAdmin.name, passwordHash, JSON.stringify(subAdmin.permissions || {})).run();
        }
      }
    }

    // 3. Update Super Admin PIN
    if (user.isSuperAdmin && data.adminPin) {
      const newPinHash = await bcrypt.hash(data.adminPin, 10);
      await env.DB.prepare('UPDATE users SET pin_hash = ? WHERE is_super_admin = 1').bind(newPinHash).run();
    }

    return new Response(JSON.stringify({ message: 'Data saved successfully.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in save-data:', error);
    return new Response(JSON.stringify({ error: 'Failed to save data.', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
