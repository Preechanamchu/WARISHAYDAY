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
    const orderId = url.searchParams.get('orderNumber') || url.searchParams.get('id');

    // Get member's tags
    const tagsRes = await env.DB.prepare(
      'SELECT tag FROM customer_tags WHERE member_id = ?'
    ).bind(memberId).all();

    const tagList = (tagsRes.results || []).map(t => String(t.tag).trim().toUpperCase());

    if (orderId) {
      // Single order detail
      let order = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(orderId).first();
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
      let tx = await env.DB.prepare(`
        SELECT balance_before, balance_after, amount
        FROM wallet_transactions
        WHERE member_id = ? AND reference = ?
      `).bind(memberId, orderId).first();

      let parsedItems = {};
      try {
        parsedItems = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || {});
      } catch (_) {}

      const creditBefore = tx ? Number(tx.balance_before) : (order.credit_before != null ? Number(order.credit_before) : null);
      const creditAfter = tx ? Number(tx.balance_after) : (order.credit_after != null ? Number(order.credit_after) : null);
      const creditDeducted = tx ? Number(tx.amount) : (order.total != null ? Number(order.total) : null);

      return new Response(JSON.stringify({
        success: true,
        order: {
          id: order.order_id,
          orderNumber: order.order_id,
          total: Number(order.total) || 0,
          totalAmount: Number(order.total) || 0,
          customerTag: order.customer_tag || '',
          customerEmail: order.customer_email || '',
          paymentMethod: order.payment_method || 'PROMPTPAY',
          status: order.status || 'PENDING',
          createdAt: order.timestamp,
          timestamp: order.timestamp,
          items: parsedItems,
          creditBefore,
          creditAfter,
          creditDeducted,
          creditTransaction: (creditBefore !== null || creditAfter !== null) ? {
            balanceBefore: creditBefore || 0,
            balanceAfter: creditAfter || 0,
            amount: creditDeducted || 0
          } : null
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
        SELECT order_id, total, customer_tag, customer_email, payment_method, status, timestamp, items, credit_before, credit_after
        FROM orders
        WHERE member_id = ? OR UPPER(TRIM(customer_tag)) IN (${placeholders})
        ORDER BY timestamp DESC
        LIMIT 100
      `;
      const res = await env.DB.prepare(query).bind(memberId, ...tagList).all();
      orders = res.results || [];
    } else {
      const res = await env.DB.prepare(`
        SELECT order_id, total, customer_tag, customer_email, payment_method, status, timestamp, items, credit_before, credit_after
        FROM orders
        WHERE member_id = ?
        ORDER BY timestamp DESC
        LIMIT 100
      `).bind(memberId).all();
      orders = res.results || [];
    }

    return new Response(JSON.stringify({
      success: true,
      orders: orders.map(o => {
        let parsedItems = {};
        try {
          parsedItems = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || {});
        } catch (_) {}

        return {
          id: o.order_id,
          orderNumber: o.order_id,
          total: Number(o.total) || 0,
          totalAmount: Number(o.total) || 0,
          customerTag: o.customer_tag || '',
          paymentMethod: o.payment_method || 'PROMPTPAY',
          status: o.status || 'PENDING',
          createdAt: o.timestamp,
          timestamp: o.timestamp,
          items: parsedItems,
          creditBefore: o.credit_before,
          creditAfter: o.credit_after
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
