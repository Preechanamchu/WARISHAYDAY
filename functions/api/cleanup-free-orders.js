// functions/api/cleanup-free-orders.js

export async function onRequest(context) {
  const { env } = context;

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = await env.DB.prepare(
      'DELETE FROM orders WHERE is_free_order = 1 AND timestamp < ?'
    ).bind(twoDaysAgo).run();

    return new Response(JSON.stringify({
      deleted: result.meta.changes,
      retentionDays: 2
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in cleanup-free-orders:', error);
    return new Response(JSON.stringify({ error: 'Failed to clean up free orders.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
