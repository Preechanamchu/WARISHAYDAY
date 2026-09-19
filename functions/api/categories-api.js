// functions/api/categories-api.js
import { authenticateRequest } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  // Read URL params
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ? parseInt(url.searchParams.get('id')) : null;

  if (method === 'GET') {
    const result = await env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();
    const categories = (result.results || []).map(c => ({
      ...c,
      per_piece_prices: typeof c.per_piece_prices === 'string' ? JSON.parse(c.per_piece_prices || '[]') : (c.per_piece_prices || [])
    }));
    return new Response(JSON.stringify(categories), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mutations require auth
  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'POST') {
      const body = await request.json();
      const { name, name_en, icon, min_order_quantity, sort_order } = body;

      // In SQLite/D1, get max ID or let AUTOINCREMENT work
      const maxIdRes = await env.DB.prepare('SELECT MAX(id) as max_id FROM categories').first();
      const newId = (maxIdRes?.max_id || 0) + 1;

      await env.DB.prepare(
        'INSERT INTO categories (id, name, name_en, icon, min_order_quantity, per_piece_prices, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(newId, name, name_en, icon, min_order_quantity, '[]', sort_order).run();

      return new Response(JSON.stringify({ message: 'Category created', id: newId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'PUT' && id) {
      const body = await request.json();
      const { name, name_en, icon, min_order_quantity, per_piece_prices, sort_order } = body;

      await env.DB.prepare(
        'UPDATE categories SET name=?, name_en=?, icon=?, min_order_quantity=?, per_piece_prices=?, sort_order=? WHERE id=?'
      ).bind(name, name_en, icon, min_order_quantity, JSON.stringify(per_piece_prices || []), sort_order, id).run();

      return new Response(JSON.stringify({ message: 'Category updated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'DELETE' && id) {
      await env.DB.prepare('DELETE FROM products WHERE category_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();

      return new Response(JSON.stringify({ message: 'Category and its products deleted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in categories-api:', error);
    return new Response(JSON.stringify({ error: 'Database operation failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
