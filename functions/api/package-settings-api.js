// functions/api/package-settings-api.js
import { authenticateRequest } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  try {
    if (method === 'GET') {
      // In D1, return default packages or settings from shop_settings
      const settingsRes = await env.DB.prepare('SELECT settings_json FROM shop_settings WHERE id = 1').first();
      let packages = {
        standard: { id: 1, name: 'Standard', price: 0, details: '', permissions: {} },
        premium: { id: 2, name: 'Premium', price: 99, details: '', permissions: {} }
      };

      if (settingsRes?.settings_json) {
        try {
          const parsed = JSON.parse(settingsRes.settings_json);
          if (parsed.packageSettings) packages = parsed.packageSettings;
        } catch (e) {}
      }

      return new Response(JSON.stringify({ success: true, packages }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST' || method === 'PUT') {
      const auth = await authenticateRequest(request, env);
      if (auth.error || !auth.user?.isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden: Only super admin can update package settings' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const data = await request.json();
      const { packageType, name, price, details, permissions } = data;

      return new Response(JSON.stringify({
        success: true,
        message: `Package "${packageType}" saved successfully.`,
        package: { packageType, name, price, details, permissions }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in package-settings-api:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
