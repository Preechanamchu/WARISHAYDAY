// functions/api/update-store.js
import bcrypt from 'bcryptjs';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const requestData = await request.json().catch(() => ({}));
    const { action } = requestData;

    let result;
    switch (action) {
      case 'approve':
        result = await approveStore(requestData, env);
        break;
      case 'assign-key':
        result = await assignSerialKey(requestData, env);
        break;
      case 'open-store':
        result = await openStore(requestData, env);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Action ${action} completed successfully`,
      data: result,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in update-store:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function approveStore(data, env) {
  const { id, packageType, status } = data;
  if (!id || !packageType) throw new Error('Missing required fields: id, packageType');

  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE store_registrations 
    SET status = ?, package_type = ?, approved_at = ?
    WHERE id = ?
  `).bind(status || 'approved', packageType, now, id).run();

  const res = await env.DB.prepare('SELECT * FROM store_registrations WHERE id = ?').bind(id).first();
  return res;
}

async function assignSerialKey(data, env) {
  const { storeId, serialKey, expiryDate } = data;
  if (!storeId || !serialKey) throw new Error('Missing required fields: storeId, serialKey');

  await env.DB.prepare(`
    UPDATE store_registrations 
    SET serial_key = ?, expiry_date = ?
    WHERE id = ?
  `).bind(serialKey, expiryDate, storeId).run();

  const res = await env.DB.prepare('SELECT * FROM store_registrations WHERE id = ?').bind(storeId).first();
  return res;
}

async function openStore(data, env) {
  const { storeId, username, password, status, openedAt } = data;
  if (!storeId || !username || !password) throw new Error('Missing required fields: storeId, username, password');

  const hashedPassword = await bcrypt.hash(password, 10);
  const now = openedAt || new Date().toISOString();

  await env.DB.prepare(`
    UPDATE store_registrations 
    SET owner_name = ?, password = ?, status = ?, opened_at = ?
    WHERE id = ?
  `).bind(username, hashedPassword, status || 'active', now, storeId).run();

  const res = await env.DB.prepare('SELECT * FROM store_registrations WHERE id = ?').bind(storeId).first();
  return res;
}
