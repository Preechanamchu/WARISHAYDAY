// functions/api/store-payment-api.js
import { authenticateRequest } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      if (action === 'get_payment_channels') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'get_payment_requests' || action === 'get_payment_history') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in store-payment-api:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
