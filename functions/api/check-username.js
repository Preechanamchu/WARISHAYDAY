// functions/api/check-username.js

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { username } = await request.json();

    if (!username) {
      return new Response(JSON.stringify({ error: 'Username is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const res = await env.DB.prepare('SELECT 1 FROM store_registrations WHERE owner_name = ?').bind(username).first();
    const isAvailable = !res;

    return new Response(JSON.stringify({ available: isAvailable }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Check Username Error:', error);
    return new Response(JSON.stringify({ error: 'Database check failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
