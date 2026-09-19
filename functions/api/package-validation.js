// functions/api/package-validation.js

export async function onRequest(context) {
  return new Response(JSON.stringify({
    valid: true,
    package: {
      type: 'standard',
      status: 'active'
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
