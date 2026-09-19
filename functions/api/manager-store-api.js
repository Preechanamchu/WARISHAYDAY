// functions/api/manager-store-api.js
import { authenticateRequest } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // Allow public access to get_store_by_name
  if (method === 'GET' && action === 'get_store_by_name') {
    return handleGetStoreByName(url, env);
  }

  // All other routes require authentication
  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      if (action === 'get_registrations') {
        const res = await env.DB.prepare("SELECT * FROM store_registrations WHERE status = 'pending' ORDER BY registered_at DESC").all();
        return new Response(JSON.stringify(res.results || []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_all_registrations') {
        const res = await env.DB.prepare("SELECT * FROM store_registrations ORDER BY registered_at DESC").all();
        const stores = res.results || [];
        const today = new Date().toISOString().split('T')[0];
        const pending = stores.filter(s => s.status === 'pending');
        const approvedToday = stores.filter(s => s.status === 'approved' && s.approved_at?.startsWith(today));
        const rejectedToday = stores.filter(s => s.status === 'rejected');

        return new Response(JSON.stringify({
          stores,
          stats: { pending: pending.length, approvedToday: approvedToday.length, rejectedToday: rejectedToday.length }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_active_stores') {
        const res = await env.DB.prepare("SELECT id, shop_name, owner_name as username, package_type, status, expiry_date, serial_key, opened_at FROM store_registrations WHERE status IN ('active', 'paused', 'expired') ORDER BY opened_at DESC").all();
        return new Response(JSON.stringify(res.results || []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_serial_keys') {
        return new Response(JSON.stringify({ keys: [], stats: { total: 0, active: 0, unused: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_payment_proofs' || action === 'get_payment_history') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_dashboard_stats') {
        const storesRes = await env.DB.prepare("SELECT status, package_type, COUNT(*) as count FROM store_registrations WHERE status IN ('active', 'paused', 'expired') GROUP BY status, package_type").all();
        return new Response(JSON.stringify({
          storesByStatus: storesRes.results || [],
          totalRevenue: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_package_permissions') {
        return new Response(JSON.stringify({ permissions: ['dashboard', 'pos', 'orders', 'products', 'stock'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const postAction = body.action || action;

      if (postAction === 'update_store_status') {
        const { storeId, status } = body;
        await env.DB.prepare('UPDATE store_registrations SET status = ? WHERE id = ?').bind(status, storeId).run();
        return new Response(JSON.stringify({ success: true, message: 'Status updated' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (postAction === 'delete_store') {
        const { storeId } = body;
        await env.DB.prepare('DELETE FROM store_registrations WHERE id = ?').bind(storeId).run();
        return new Response(JSON.stringify({ success: true, message: 'Store deleted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Invalid Action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Manager API Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetStoreByName(url, env) {
  const shopName = url.searchParams.get('shopName');
  const storeId = url.searchParams.get('storeId');

  if (!shopName && !storeId) {
    return new Response(JSON.stringify({ error: 'Shop name or store ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let store;
  if (storeId) {
    store = await env.DB.prepare("SELECT id, shop_name, owner_name, package_type, status, serial_key, expiry_date, opened_at FROM store_registrations WHERE id = ? AND status IN ('active', 'ready_to_open', 'approved')").bind(parseInt(storeId)).first();
  } else {
    store = await env.DB.prepare("SELECT id, shop_name, owner_name, package_type, status, serial_key, expiry_date, opened_at FROM store_registrations WHERE shop_name = ? AND status IN ('active', 'ready_to_open', 'approved')").bind(decodeURIComponent(shopName)).first();
  }

  if (!store) {
    return new Response(JSON.stringify({ error: 'Store not found or not active' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ store }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
