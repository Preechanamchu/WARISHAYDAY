// functions/api/get-admin-data.js
import { authenticateRequest } from './_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [
      settingsRes,
      machinesRes,
      subAdminsRes,
      ordersRes,
      logsRes,
      trafficLogsRes,
      showcaseSettingsRes,
      showcaseCatsRes,
      showcaseProdsRes,
    ] = await Promise.all([
      env.DB.prepare('SELECT settings_json FROM shop_settings WHERE id = 1').all(),
      env.DB.prepare('SELECT id, name_th, name_en, image_url, product_ids, sort_order FROM product_machines ORDER BY sort_order ASC, created_at ASC').all(),
      env.DB.prepare('SELECT id, username, name, permissions FROM users WHERE is_super_admin = 0').all(),
      env.DB.prepare('SELECT * FROM orders ORDER BY timestamp DESC').all(),
      env.DB.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200').all(),
      env.DB.prepare("SELECT timestamp FROM logs WHERE action IN ('page_view', 'category_click', 'product_click') ORDER BY timestamp DESC LIMIT 1000").all(),
      env.DB.prepare('SELECT * FROM showcase_settings WHERE id = 1').all(),
      env.DB.prepare('SELECT * FROM showcase_category_settings ORDER BY category_id').all(),
      env.DB.prepare('SELECT product_id FROM showcase_products ORDER BY product_id').all(),
    ]);

    let persistedSettings = {};
    if (settingsRes.results && settingsRes.results[0]?.settings_json) {
      try {
        persistedSettings = JSON.parse(settingsRes.results[0].settings_json);
      } catch (e) {
        persistedSettings = {};
      }
    }

    const productMachines = (machinesRes.results || []).map((row, idx) => {
      let productIds = [];
      try {
        productIds = typeof row.product_ids === 'string' ? JSON.parse(row.product_ids) : (row.product_ids || []);
      } catch (e) {
        productIds = [];
      }
      return {
        id: String(row.id),
        name: String(row.name_th || ''),
        name_en: String(row.name_en || ''),
        imageUrl: String(row.image_url || ''),
        productIds: Array.isArray(productIds) ? productIds : [],
        sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : idx,
      };
    });

    const showcaseRow = showcaseSettingsRes.results?.[0];
    let showcaseSettings = {
      selectedProductIds: (showcaseProdsRes.results || []).map(r => r.product_id),
      categories: {},
      maxItems: showcaseRow ? showcaseRow.max_items : 10,
      effect: {
        enabled: showcaseRow ? Boolean(showcaseRow.effect_enabled) : false,
        type: showcaseRow ? showcaseRow.effect_type : 'confetti',
        intensity: showcaseRow ? showcaseRow.effect_intensity : 30,
      },
    };

    (showcaseCatsRes.results || []).forEach(cat => {
      showcaseSettings.categories[String(cat.category_id)] = {
        title: cat.title || '',
        fontSize: Number(cat.font_size) || 26,
        fontFamily: cat.font_family || "'Kanit', sans-serif",
        boldEnabled: Boolean(cat.font_bold),
        textColor: cat.text_color || '#172554',
        strokeColor: cat.stroke_color || '#ffffff',
        shadowEnabled: Boolean(cat.shadow_enabled),
        shadowStrength: Number(cat.shadow_strength) || 6,
      };
    });

    persistedSettings.showcaseSettings = showcaseSettings;

    const subAdmins = (subAdminsRes.results || []).map(u => ({
      ...u,
      permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions || '{}') : (u.permissions || {}),
    }));

    const orders = (ordersRes.results || []).map(o => {
      let items = {};
      try {
        items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || {});
      } catch (e) {
        items = {};
      }
      return {
        ...o,
        items,
        is_free_order: Boolean(o.is_free_order),
      };
    });

    // Calculate traffic statistics
    const dailyTraffic = Array(7).fill(0);
    const hourlyTraffic = Array(24).fill(0);
    const now = new Date();

    (trafficLogsRes.results || []).forEach(log => {
      if (!log.timestamp) return;
      const logDate = new Date(log.timestamp);
      const daysAgo = Math.floor((now.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 0 && daysAgo < 7) {
        const dailyIndex = (6 - daysAgo + 7) % 7;
        dailyTraffic[dailyIndex]++;
      }

      const hoursAgo = Math.floor((now.getTime() - logDate.getTime()) / (1000 * 60 * 60));
      if (hoursAgo >= 0 && hoursAgo < 24) {
        const hourlyIndex = (23 - hoursAgo + 24) % 24;
        hourlyTraffic[hourlyIndex]++;
      }
    });

    const adminData = {
      shopSettings: {
        ...persistedSettings,
        productMachines,
      },
      subAdmins: subAdmins,
      analytics: {
        orders: orders,
        logs: logsRes.results || [],
        dailyTraffic: dailyTraffic,
        hourlyTraffic: hourlyTraffic,
      },
    };

    return new Response(JSON.stringify(adminData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch admin data.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
