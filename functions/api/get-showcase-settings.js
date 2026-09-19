// functions/api/get-showcase-settings.js
import { authenticateRequest } from './_auth.js';

const EFFECT_TYPES = new Set(['confetti', 'sparkles', 'balloons', 'petals', 'fireworks']);

const normalizeSettings = (raw = {}) => {
  const effect = raw.effect && typeof raw.effect === 'object' ? raw.effect : {};
  const categories = raw.categories && typeof raw.categories === 'object' && !Array.isArray(raw.categories) ? raw.categories : {};
  return {
    selectedProductIds: Array.isArray(raw.selectedProductIds) ? [...new Set(raw.selectedProductIds.map(Number).filter(Number.isFinite))] : [],
    categories,
    maxItems: Math.min(100000, Math.max(1, Math.floor(Number(raw.maxItems) || 10))),
    effect: {
      enabled: effect.enabled === true,
      type: EFFECT_TYPES.has(effect.type) ? effect.type : 'confetti',
      intensity: Math.min(80, Math.max(10, Math.floor(Number(effect.intensity) || 30))),
    },
  };
};

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const [settingsRes, catsRes, prodsRes] = await Promise.all([
      env.DB.prepare('SELECT * FROM showcase_settings WHERE id = 1').first(),
      env.DB.prepare('SELECT * FROM showcase_category_settings ORDER BY category_id').all(),
      env.DB.prepare('SELECT product_id FROM showcase_products ORDER BY product_id').all(),
    ]);

    const showcaseRow = settingsRes;
    const categories = {};
    (catsRes.results || []).forEach(cat => {
      categories[String(cat.category_id)] = {
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

    const settings = {
      selectedProductIds: (prodsRes.results || []).map(r => r.product_id),
      categories,
      maxItems: showcaseRow ? showcaseRow.max_items : 10,
      effect: {
        enabled: showcaseRow ? Boolean(showcaseRow.effect_enabled) : false,
        type: showcaseRow ? showcaseRow.effect_type : 'confetti',
        intensity: showcaseRow ? showcaseRow.effect_intensity : 30,
      },
    };

    return new Response(JSON.stringify(settings), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error in get-showcase-settings (GET):', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch showcase settings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const raw = await request.json();
    const settings = normalizeSettings(raw);
    const now = new Date().toISOString();

    const stmts = [];

    stmts.push(
      env.DB.prepare(`
        INSERT INTO showcase_settings (id, max_items, effect_enabled, effect_type, effect_intensity, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          max_items = excluded.max_items,
          effect_enabled = excluded.effect_enabled,
          effect_type = excluded.effect_type,
          effect_intensity = excluded.effect_intensity,
          updated_at = excluded.updated_at
      `).bind(
        settings.maxItems,
        settings.effect.enabled ? 1 : 0,
        settings.effect.type,
        settings.effect.intensity,
        now
      )
    );

    stmts.push(env.DB.prepare('DELETE FROM showcase_category_settings'));
    Object.entries(settings.categories).forEach(([catId, cat]) => {
      const numId = Number(catId);
      if (!Number.isFinite(numId)) return;
      stmts.push(
        env.DB.prepare(`
          INSERT INTO showcase_category_settings
            (category_id, title, font_size, font_family, font_bold, text_color, stroke_color, shadow_enabled, shadow_strength, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          numId,
          String(cat.title || ''),
          Math.min(64, Math.max(12, Math.floor(Number(cat.fontSize) || 26))),
          String(cat.fontFamily || "'Kanit', sans-serif"),
          cat.boldEnabled ? 1 : 0,
          String(cat.textColor || '#172554'),
          String(cat.strokeColor || '#ffffff'),
          cat.shadowEnabled !== false ? 1 : 0,
          Math.min(20, Math.max(0, Math.floor(Number(cat.shadowStrength) || 6))),
          now
        )
      );
    });

    stmts.push(env.DB.prepare('DELETE FROM showcase_products'));
    settings.selectedProductIds.forEach(productId => {
      stmts.push(
        env.DB.prepare('INSERT INTO showcase_products (product_id, created_at) VALUES (?, ?)')
          .bind(productId, now)
      );
    });

    await env.DB.batch(stmts);

    return new Response(JSON.stringify(settings), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving showcase settings:', error);
    return new Response(JSON.stringify({ error: 'Failed to save showcase settings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
