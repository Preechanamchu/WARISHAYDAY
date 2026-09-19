// functions/api/orders-api.js

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    if (method === 'POST') {
      const orderData = await request.json();
      return await createOrder(orderData, env);
    }

    if (method === 'PUT') {
      if (!id) {
        return new Response(JSON.stringify({ error: 'Order ID is required for updates.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const updateData = await request.json();
      return await updateOrder(id, updateData, env);
    }

    if (method === 'DELETE') {
      if (!id) {
        return new Response(JSON.stringify({ error: 'Order ID is required for deletion.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return await deleteOrder(id, env);
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in orders-api:', error);
    return new Response(JSON.stringify({ error: `An internal server error occurred: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function createOrder(orderData, env) {
  if (!orderData || !orderData.id || !orderData.items || typeof orderData.total === 'undefined') {
    return new Response(JSON.stringify({ error: 'Invalid order data provided.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const itemsJson = typeof orderData.items === 'object' ? JSON.stringify(orderData.items) : String(orderData.items);
  const promoJson = orderData.promoApplied ? (typeof orderData.promoApplied === 'object' ? JSON.stringify(orderData.promoApplied) : String(orderData.promoApplied)) : null;
  const upgradeSnapshotJson = orderData.upgradeSnapshot ? (typeof orderData.upgradeSnapshot === 'object' ? JSON.stringify(orderData.upgradeSnapshot) : String(orderData.upgradeSnapshot)) : null;
  const customerTagValue = orderData.customerTag || orderData.customer_tag || null;
  const customerEmailValue = orderData.customerEmail || orderData.customer_email || null;
  const isFreeOrder = Number(orderData.total) === 0 ? 1 : 0;
  const storeId = orderData.storeId ? Number(orderData.storeId) : 1;
  const paymentMethod = String(orderData.paymentMethod || orderData.payment_method || 'PROMPTPAY').toUpperCase();

  let memberId = null;
  let creditBefore = null;
  let creditAfter = null;

  // Check if customer_tag matches any member
  if (customerTagValue) {
    try {
      const cleanTag = String(customerTagValue).trim().toUpperCase();
      const tagRow = await env.DB.prepare(`
        SELECT ct.member_id, m.status, w.id as wallet_id, w.balance, w.total_spent
        FROM customer_tags ct
        JOIN members m ON m.id = ct.member_id
        LEFT JOIN wallets w ON w.member_id = ct.member_id
        WHERE UPPER(TRIM(ct.tag)) = ? AND ct.status = 'ACTIVE'
      `).bind(cleanTag).first();

      if (tagRow && tagRow.member_id) {
        memberId = tagRow.member_id;

        // If paying with Member Credit
        if (paymentMethod === 'CREDIT' && !isFreeOrder) {
          if (tagRow.status !== 'ACTIVE') {
            return new Response(JSON.stringify({ error: 'บัญชีสมาชิกถูกระงับ ไม่สามารถชำระด้วยเครดิตได้' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const orderTotal = Number(orderData.total) || 0;
          const currentBal = Number(tagRow.balance) || 0;

          if (currentBal < orderTotal) {
            return new Response(JSON.stringify({ 
              error: `ยอดเครดิตคงเหลือไม่เพียงพอ (คงเหลือ ฿${currentBal.toLocaleString()}, ยอดสั่งซื้อ ฿${orderTotal.toLocaleString()})` 
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          creditBefore = currentBal;
          creditAfter = currentBal - orderTotal;
        }
      }
    } catch (tagErr) {
      console.error('Tag matching error:', tagErr);
    }
  }

  let currentId = orderData.id;
  let success = false;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts && !success) {
    try {
      const now = orderData.timestamp || new Date().toISOString();

      if (paymentMethod === 'CREDIT' && memberId && creditBefore !== null && creditAfter !== null) {
        // Atomic transaction: Insert order + Deduct wallet + Ledger + Activity
        const txCode = `PUR-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
        const orderTotal = Number(orderData.total) || 0;

        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO orders (order_id, timestamp, total, items, status, promo_applied, upgrade_snapshot, customer_tag, customer_email, is_free_order, store_id, member_id, credit_before, credit_after, payment_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            currentId, now, orderData.total, itemsJson, 'new', promoJson, upgradeSnapshotJson, customerTagValue, customerEmailValue, isFreeOrder, storeId, memberId, creditBefore, creditAfter, 'CREDIT'
          ),
          env.DB.prepare(`
            UPDATE wallets 
            SET balance = ?, total_spent = total_spent + ?, updated_at = ? 
            WHERE member_id = ?
          `).bind(creditAfter, orderTotal, now, memberId),
          env.DB.prepare(`
            INSERT INTO wallet_transactions (transaction_code, wallet_id, member_id, type, amount, balance_before, balance_after, reference, status, note, created_at)
            VALUES (?, (SELECT id FROM wallets WHERE member_id = ?), ?, 'PURCHASE', ?, ?, ?, ?, 'COMPLETED', ?, ?)
          `).bind(txCode, memberId, memberId, -orderTotal, creditBefore, creditAfter, currentId, `ชำระคำสั่งซื้อ #${currentId}`, now),
          env.DB.prepare(`
            INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
            VALUES (?, 'ORDER', ?, ?, ?)
          `).bind(memberId, `สั่งซื้อสินค้า #${currentId} ผ่านเครดิต ฿${orderTotal.toLocaleString()}`, JSON.stringify({ orderId: currentId, total: orderTotal }), now)
        ]);
      } else {
        // Standard order (PromptPay, etc.)
        await env.DB.prepare(`
          INSERT INTO orders (order_id, timestamp, total, items, status, promo_applied, upgrade_snapshot, customer_tag, customer_email, is_free_order, store_id, member_id, credit_before, credit_after, payment_method)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          currentId, now, orderData.total, itemsJson, 'new', promoJson, upgradeSnapshotJson, customerTagValue, customerEmailValue, isFreeOrder, storeId, memberId, creditBefore, creditAfter, paymentMethod
        ).run();
      }

      success = true;
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('PRIMARY KEY') || err.message.includes('constraint'))) {
        attempts++;
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        currentId = `${orderData.id}-${randomSuffix}`;
      } else {
        throw err;
      }
    }
  }

  if (!success) {
    return new Response(JSON.stringify({ error: 'Failed to create unique order ID.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    message: 'Order created successfully',
    orderId: currentId,
    status: 'new',
    memberId,
    paymentMethod,
    creditRemaining: creditAfter,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function updateOrder(id, data, env) {
  const allowedStatus = ['new', 'active', 'cancelled', 'completed'];
  if (data.status && !allowedStatus.includes(data.status)) {
    return new Response(JSON.stringify({ error: 'Invalid status provided.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fields = [];
  const values = [];

  if (data.status) {
    fields.push('status = ?');
    values.push(data.status);
  }

  if (fields.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields provided for update.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  values.push(id);
  const query = `UPDATE orders SET ${fields.join(', ')} WHERE order_id = ?`;
  const res = await env.DB.prepare(query).bind(...values).run();

  if (res.meta.changes === 0) {
    return new Response(JSON.stringify({ error: `Order with ID ${id} not found.` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    message: `Order ${id} updated successfully`,
    changes: res.meta.changes,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function deleteOrder(id, env) {
  const res = await env.DB.prepare('DELETE FROM orders WHERE order_id = ?').bind(id).run();
  if (res.meta.changes === 0) {
    return new Response(JSON.stringify({ error: `Order with ID ${id} not found.` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    message: `Order ${id} deleted successfully`
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
