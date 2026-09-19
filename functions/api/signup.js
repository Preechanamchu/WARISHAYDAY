// functions/api/signup.js

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const {
      shopName, shopAge, shopLink,
      username, password,
      contacts, packageType,
      registeredAt, status
    } = data;

    if (!shopName || !username || !password) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const maxIdRes = await env.DB.prepare('SELECT MAX(id) as max_id FROM store_registrations').first();
    const newId = (maxIdRes?.max_id || 0) + 1;

    const query = `
      INSERT INTO store_registrations 
      (id, shop_name, shop_age, shop_link, owner_name, password, status, registered_at, contact_line, contact_facebook, contact_phone, package_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await env.DB.prepare(query).bind(
      newId,
      shopName,
      shopAge ? (typeof shopAge === 'object' ? JSON.stringify(shopAge) : String(shopAge)) : '',
      shopLink || '',
      username,
      password,
      status || 'pending',
      registeredAt || new Date().toISOString(),
      contacts?.line || '',
      contacts?.facebook || '',
      contacts?.phone || '',
      packageType || 'standard'
    ).run();

    return new Response(JSON.stringify({ success: true, data: { id: newId, shop_name: shopName, owner_name: username } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Signup Error:', error);
    if (error.message && (error.message.includes('UNIQUE') || error.message.includes('constraint'))) {
      return new Response(JSON.stringify({ error: 'Username นี้ถูกใช้งานแล้ว' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Database error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
