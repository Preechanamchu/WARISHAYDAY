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

  let currentId = orderData.id;
  let success = false;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts && !success) {
    try {
      await env.DB.prepare(`
        INSERT INTO orders (order_id, timestamp, total, items, status, promo_applied, upgrade_snapshot, customer_tag, customer_email, is_free_order, store_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        currentId,
        orderData.timestamp || new Date().toISOString(),
        orderData.total,
        itemsJson,
        'new',
        promoJson,
        upgradeSnapshotJson,
        customerTagValue,
        customerEmailValue,
        isFreeOrder,
        storeId
      ).run();

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
    status: 'new'
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
