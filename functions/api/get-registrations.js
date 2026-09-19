// functions/api/get-registrations.js

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const res = await env.DB.prepare('SELECT * FROM store_registrations ORDER BY registered_at DESC').all();

    const registrations = (res.results || []).map(row => {
      let contacts = {};
      try {
        contacts = {
          line: row.contact_line,
          facebook: row.contact_facebook,
          phone: row.contact_phone,
        };
      } catch (e) {
        contacts = {};
      }

      return {
        id: row.id,
        shopName: row.shop_name,
        shopAge: row.shop_age,
        shopLink: row.shop_link,
        ownerName: row.owner_name,
        packageType: row.package_type,
        status: row.status,
        registeredAt: row.registered_at,
        contacts: contacts,
        phone: row.contact_phone || row.contact_line || row.contact_facebook || '-',
        email: '-',
      };
    });

    return new Response(JSON.stringify({ registrations }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Get Registrations Error:', error);
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
