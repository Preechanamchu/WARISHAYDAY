// functions/api/get-customer-data.js

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const [categoriesRes, productsRes, settingsRes, machinesRes, showcaseSettingsRes, showcaseCatsRes, showcaseProdsRes] = await Promise.all([
      env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all(),
      env.DB.prepare('SELECT * FROM products ORDER BY category_id, level ASC').all(),
      env.DB.prepare('SELECT settings_json FROM shop_settings WHERE id = 1').all(),
      env.DB.prepare('SELECT id, name_th, name_en, image_url, product_ids, sort_order FROM product_machines ORDER BY sort_order ASC, created_at ASC').all(),
      env.DB.prepare('SELECT * FROM showcase_settings WHERE id = 1').all(),
      env.DB.prepare('SELECT * FROM showcase_category_settings ORDER BY category_id').all(),
      env.DB.prepare('SELECT product_id FROM showcase_products ORDER BY product_id').all(),
    ]);

    const categories = (categoriesRes.results || []).map(c => {
      let prices = [];
      try {
        prices = typeof c.per_piece_prices === 'string' ? JSON.parse(c.per_piece_prices) : (c.per_piece_prices || []);
      } catch (e) {
        prices = [];
      }
      return {
        ...c,
        per_piece_prices: prices,
      };
    });

    const products = (productsRes.results || []).map(p => ({
      ...p,
      is_available: Boolean(p.is_available),
      hidden: Boolean(p.hidden),
    }));

    let allShopSettings = {};
    if (settingsRes.results && settingsRes.results[0]?.settings_json) {
      try {
        allShopSettings = JSON.parse(settingsRes.results[0].settings_json);
      } catch (e) {
        allShopSettings = {};
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

    // Showcase settings reconstruction
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

    const safeShopSettings = {
      shopName: allShopSettings.shopName,
      slogan: allShopSettings.slogan,
      shopNameColor: allShopSettings.shopNameColor,
      sloganColor: allShopSettings.sloganColor,
      themeName: allShopSettings.themeName,
      logo: allShopSettings.logo,
      useLogo: allShopSettings.useLogo,
      darkMode: allShopSettings.darkMode,
      fontFamily: allShopSettings.fontFamily,
      globalFontFamily: allShopSettings.globalFontFamily,
      globalFontSize: allShopSettings.globalFontSize,
      mainMenuFontSize: allShopSettings.mainMenuFontSize,
      subMenuFontSize: allShopSettings.subMenuFontSize,
      shopNameFontSize: allShopSettings.shopNameFontSize,
      sloganFontSize: allShopSettings.sloganFontSize,
      sloganFontFamily: allShopSettings.sloganFontFamily,
      shopNameEffect: allShopSettings.shopNameEffect,
      sloganEffect: allShopSettings.sloganEffect,
      logoEffect: allShopSettings.logoEffect,
      effects: allShopSettings.effects,
      backgroundImage: allShopSettings.backgroundImage,
      backgroundOpacity: allShopSettings.backgroundOpacity,
      backgroundBlur: allShopSettings.backgroundBlur,
      copyrightText: allShopSettings.copyrightText,
      copyrightOpacity: allShopSettings.copyrightOpacity,
      shopEnabled: allShopSettings.shopEnabled,
      announcementEnabled: allShopSettings.announcementEnabled,
      shopClosedMessageText: allShopSettings.shopClosedMessageText,
      announcementMessageText: allShopSettings.announcementMessageText,
      messageSettings: allShopSettings.messageSettings,
      registrationEnabled: allShopSettings.registrationEnabled ?? true,
      salesMode: allShopSettings.salesMode,
      orderBarSettings: allShopSettings.orderBarSettings,
      gridLayoutSettings: allShopSettings.gridLayoutSettings,
      priceTagConfig: allShopSettings.priceTagConfig,
      priceTagUpgradeConfig: allShopSettings.priceTagUpgradeConfig || { closingMessage: '', fontSize: 50 },
      priceTagCoinConfig: allShopSettings.priceTagCoinConfig || { closingMessage: '', fontSize: 50 },
      priceTagDiamondConfig: allShopSettings.priceTagDiamondConfig || { closingMessage: '', fontSize: 50 },
      priceTagVoucherConfig: allShopSettings.priceTagVoucherConfig || { closingMessage: '', fontSize: 50 },
      priceTagProductMachinesConfig: allShopSettings.priceTagProductMachinesConfig || { closingMessage: '', fontSize: 50 },
      loadingScreen: allShopSettings.loadingScreen,
      successAnimation: allShopSettings.successAnimation,
      language: allShopSettings.language,
      coinPackages: allShopSettings.coinPackages || [],
      diamondPackages: allShopSettings.diamondPackages || [],
      farmPassPackages: allShopSettings.farmPassPackages || [],
      voucherPackages: allShopSettings.voucherPackages || [],
      upgradeSettings: allShopSettings.upgradeSettings || {},
      productMachines: productMachines,
      showcaseSettings: showcaseSettings,
      copyrightFontSize: allShopSettings.copyrightFontSize,
      stockSubMenuOrder: allShopSettings.stockSubMenuOrder,
      catalogVisibility: allShopSettings.catalogVisibility,
      sectionBackgrounds: allShopSettings.sectionBackgrounds,
      tagTutorialVideoUrl: allShopSettings.tagTutorialVideoUrl,
      tagTutorialVideoFile: allShopSettings.tagTutorialVideoFile,
      mailTutorialVideoUrl: allShopSettings.mailTutorialVideoUrl,
      mailTutorialVideoFile: allShopSettings.mailTutorialVideoFile,
      coinTutorialVideoUrl: allShopSettings.coinTutorialVideoUrl,
      coinTutorialVideoFile: allShopSettings.coinTutorialVideoFile,
    };

    const customerData = {
      categories: categories,
      products: products,
      shopSettings: safeShopSettings,
    };

    return new Response(JSON.stringify(customerData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error in get-customer-data:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch customer data.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
