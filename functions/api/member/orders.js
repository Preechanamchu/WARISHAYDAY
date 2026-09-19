// functions/api/member/orders.js
import { authenticateRequest } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const memberId = auth.user.memberId;
  if (!memberId) {
    return new Response(JSON.stringify({ error: 'ไม่พบสิทธิ์สมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('id');

    // Get member's tags
    const tagsRes = await env.DB.prepare(
      'SELECT tag FROM customer_tags WHERE member_id = ?'
    ).bind(memberId).all();

    const tagList = (tagsRes.results || []).map(t => String(t.tag).trim().toUpperCase());

    if (orderId) {
      // Single order detail
      let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
      if (!order) {
        return new Response(JSON.stringify({ error: 'ไม่พบคำสั่งซื้อนี้' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Security check: order must belong to this member or match one of their tags
      const orderTag = String(order.customer_tag || '').trim().toUpperCase();
      const isOwner = order.member_id === memberId || (orderTag && tagList.includes(orderTag));
      if (!isOwner) {
        return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึงคำสั่งซื้อนี้' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check related wallet transaction for credit before/after
      const tx = await env.DB.prepare(`
        SELECT balance_before, balance_after, amount
        FROM wallet_transactions
        WHERE member_id = ? AND reference_id = ? AND reference_type = 'ORDER'
      `).bind(memberId, orderId).first();

      let parsedItems = [];
      try {
        parsedItems = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
      } catch (_) {}

      return new Response(JSON.stringify({
        success: true,
        order: {
          id: order.id,
          total: Number(order.total) || 0,
          customerTag: order.customer_tag,
          paymentMethod: order.payment_method,
          status: order.status,
          createdAt: order.created_at,
          items: parsedItems,
          note: order.note,
          creditBefore: tx ? Number(tx.balance_before) : null,
          creditAfter: tx ? Number(tx.balance_after) : null,
          creditDeducted: tx ? Number(tx.amount) : null,
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // List orders for this member
    let orders = [];
    if (tagList.length > 0) {
      const placeholders = tagList.map(() => '?').join(',');
      const query = `
        SELECT id, total, customer_tag, payment_method, status, created_at, items, note
        FROM orders
        WHERE member_id = ? OR UPPER(TRIM(customer_tag)) IN (${placeholders})
        ORDER BY id DESC
        LIMIT 100
      `;
      const res = await env.DB.prepare(query).bind(memberId, ...tagList).all();
      orders = res.results || [];
    } else {
      const res = await env.DB.prepare(`
        SELECT id, total, customer_tag, payment_method, status, created_at, items, note
        FROM orders
        WHERE member_id = ?
        ORDER BY id DESC
        LIMIT 100
      `).bind(memberId).all();
      orders = res.results || [];
    }

    return new Response(JSON.stringify({
      success: true,
      orders: orders.map(o => {
        let parsedItems = [];
        try {
          parsedItems = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
        } catch (_) {}

        return {
          id: o.id,
          total: Number(o.total) || 0,
          customerTag: o.customer_tag,
          paymentMethod: o.payment_method,
          status: o.status,
          createdAt: o.created_at,
          items: parsedItems,
          itemCount: Array.isArray(parsedItems) ? parsedItems.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0) : 0,
          note: o.note
        };
      })
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Error fetching member orders:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการโหลดประวัติการสั่งซื้อ: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
