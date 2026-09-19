// functions/api/products-api.js
import { authenticateRequest } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const url = new URL(request.url);
  const id = url.searchParams.get('id') ? parseInt(url.searchParams.get('id')) : null;

  try {
    if (method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM products ORDER BY category_id, level ASC').all();
      const products = (result.results || []).map(p => ({
        ...p,
        is_available: Boolean(p.is_available),
        hidden: Boolean(p.hidden)
      }));
      return new Response(JSON.stringify(products), {
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

    if (method === 'POST') {
      const body = await request.json();
      const { name, name_en, level, category_id, stock, is_available, icon, unavailable_message } = body;

      const maxIdRes = await env.DB.prepare('SELECT MAX(id) as max_id FROM products').first();
      const newId = (maxIdRes?.max_id || 0) + 1;

      await env.DB.prepare(
        'INSERT INTO products (id, name, name_en, level, category_id, stock, is_available, icon, unavailable_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(newId, name, name_en, level, category_id, stock, is_available ? 1 : 0, icon, unavailable_message).run();

      return new Response(JSON.stringify({ message: 'Product created', id: newId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'PUT' && id) {
      const updates = await request.json();
      const fields = [];
      const values = [];

      const allowedFields = ['name', 'name_en', 'level', 'category_id', 'stock', 'is_available', 'icon', 'unavailable_message', 'hidden'];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          fields.push(`${field} = ?`);
          let val = updates[field];
          if (typeof val === 'boolean') val = val ? 1 : 0;
          values.push(val);
        }
      }

      if (fields.length === 0) {
        return new Response(JSON.stringify({ error: 'No fields to update' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      values.push(id);
      const updateQuery = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;
      await env.DB.prepare(updateQuery).bind(...values).run();

      return new Response(JSON.stringify({ message: 'Product updated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'DELETE' && id) {
      await env.DB.prepare('DELETE FROM showcase_products WHERE product_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();

      return new Response(JSON.stringify({ message: 'Product deleted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in products-api:', error);
    return new Response(JSON.stringify({ error: 'Database operation failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
