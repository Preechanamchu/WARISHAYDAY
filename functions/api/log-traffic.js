// functions/api/log-traffic.js

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json().catch(() => ({}));
    const action = data.action || 'unknown_action';

    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown_ip';
    const details = `IP: ${clientIp}`;
    const user = 'Guest';
    const now = new Date().toISOString();

    await env.DB.prepare(
      'INSERT INTO logs (timestamp, user_name, action, details) VALUES (?, ?, ?, ?)'
    ).bind(now, user, action, details).run();

    return new Response(JSON.stringify({ message: 'Log entry created.' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in log-traffic:', error);
    return new Response(JSON.stringify({ error: 'Failed to log traffic, but operation continues.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
