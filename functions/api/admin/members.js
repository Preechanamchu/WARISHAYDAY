// functions/api/admin/members.js
import bcrypt from 'bcryptjs';
import { authenticateRequest } from '../_auth.js';
import { hasMemberAdminAccess } from './_member-access.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only Super Admin or Admin with member permission
  const user = auth.user;
  if (!hasMemberAdminAccess(user)) {
    return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลสมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      return await handleGetMembers(request, env);
    }
    if (method === 'POST') {
      return await handleCreateMember(request, env, user);
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/members:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการโหลดข้อมูลสมาชิก', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetMembers(request, env) {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').trim();
  const status = url.searchParams.get('status') || 'ALL';
  const credit = url.searchParams.get('credit') || 'ALL';
  const dateRange = url.searchParams.get('dateRange') || 'all';
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const sortBy = url.searchParams.get('sortBy') || 'id';
  const sortOrder = (url.searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '10', 10)));
  const offset = (page - 1) * limit;

  // Base query joining members, wallets, customer_tags, and orders
  let whereClauses = ['1=1'];
  let params = [];

  if (status !== 'ALL') {
    whereClauses.push('m.status = ?');
    params.push(status.toUpperCase());
  }

  if (credit === 'HAS_CREDIT') {
    whereClauses.push('COALESCE(w.balance, 0) > 0');
  } else if (credit === 'NO_CREDIT') {
    whereClauses.push('COALESCE(w.balance, 0) <= 0');
  }

  // Date range filters
  const now = new Date();
  if (dateRange === 'today') {
    const todayStr = now.toISOString().slice(0, 10);
    whereClauses.push("m.created_at >= ?");
    params.push(`${todayStr}T00:00:00.000Z`);
  } else if (dateRange === '7days') {
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    whereClauses.push('m.created_at >= ?');
    params.push(d7);
  } else if (dateRange === '30days') {
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    whereClauses.push('m.created_at >= ?');
    params.push(d30);
  } else if (dateRange === 'custom' && startDate && endDate) {
    whereClauses.push('m.created_at >= ? AND m.created_at <= ?');
    params.push(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`);
  }

  // Search filter
  if (search) {
    const cleanSearch = `%${search.replace(/[%_]/g, '')}%`;
    const numericId = parseInt(search.replace(/[^0-9]/g, ''), 10);
    
    whereClauses.push(`(
      m.username LIKE ? 
      OR m.first_name LIKE ? 
      OR m.last_name LIKE ? 
      OR m.phone LIKE ? 
      OR EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.member_id = m.id AND ct.tag LIKE ?)
      ${!isNaN(numericId) ? 'OR m.id = ?' : ''}
    )`);
    params.push(cleanSearch, cleanSearch, cleanSearch, cleanSearch, cleanSearch);
    if (!isNaN(numericId)) {
      params.push(numericId);
    }
  }

  const whereSql = whereClauses.join(' AND ');

  // Count query
  const countSql = `
    SELECT COUNT(DISTINCT m.id) as total
    FROM members m
    LEFT JOIN wallets w ON w.member_id = m.id
    WHERE ${whereSql}
  `;
  const countRes = await env.DB.prepare(countSql).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  // Sorting columns mapping
  const sortMap = {
    id: 'm.id',
    created_at: 'm.created_at',
    credit: 'COALESCE(w.balance, 0)',
    total_spent: 'COALESCE(w.total_spent, 0)',
    last_login_at: 'm.last_login_at',
  };
  const sortColumn = sortMap[sortBy] || 'm.id';

  // Main query
  const querySql = `
    SELECT 
      m.id,
      m.username,
      m.first_name,
      m.last_name,
      m.phone,
      m.status,
      m.created_at,
      m.last_login_at,
      COALESCE(w.balance, 0) as balance,
      COALESCE(w.total_deposit, 0) as total_deposit,
      COALESCE(w.total_spent, 0) as total_spent,
      (SELECT COUNT(*) FROM customer_tags ct WHERE ct.member_id = m.id) as tag_count,
      (SELECT GROUP_CONCAT(ct.tag, ', ') FROM customer_tags ct WHERE ct.member_id = m.id) as tags_str,
      (SELECT COUNT(*) FROM orders o WHERE o.member_id = m.id OR o.customer_tag IN (SELECT ct.tag FROM customer_tags ct WHERE ct.member_id = m.id)) as order_count,
      (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.member_id = m.id OR o.customer_tag IN (SELECT ct.tag FROM customer_tags ct WHERE ct.member_id = m.id)) as order_total_spent
    FROM members m
    LEFT JOIN wallets w ON w.member_id = m.id
    WHERE ${whereSql}
    ORDER BY ${sortColumn} ${sortOrder}
    LIMIT ? OFFSET ?
  `;

  const rows = await env.DB.prepare(querySql).bind(...params, limit, offset).all();

  const members = (rows.results || []).map(r => ({
    id: r.id,
    memberCode: `#${String(r.id).padStart(6, '0')}`,
    username: r.username,
    fullName: [r.first_name, r.last_name].filter(Boolean).join(' ') || '-',
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    phone: r.phone || '-',
    status: r.status,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at || '-',
    balance: Number(r.balance) || 0,
    totalDeposit: Number(r.total_deposit) || 0,
    totalSpent: Number(r.order_total_spent || r.total_spent) || 0,
    tagCount: Number(r.tag_count) || 0,
    tags: r.tags_str ? r.tags_str.split(', ') : [],
    orderCount: Number(r.order_count) || 0,
  }));

  return new Response(JSON.stringify({
    members,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleCreateMember(request, env, adminUser) {
  const body = await request.json();
  const { username, password, firstName, lastName, phone, tags } = body;

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'กรุณากรอก Username และ Password' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trimmedUsername = String(username).trim();
  const existing = await env.DB.prepare('SELECT id FROM members WHERE LOWER(username) = LOWER(?)').bind(trimmedUsername).first();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Username นี้ถูกใช้งานแล้ว' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  // Insert member
  const insertRes = await env.DB.prepare(`
    INSERT INTO members (username, password_hash, first_name, last_name, phone, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `).bind(
    trimmedUsername,
    passwordHash,
    (firstName || '').trim(),
    (lastName || '').trim(),
    (phone || '').trim(),
    now,
    now
  ).run();

  const memberId = insertRes.meta.last_row_id;

  // Create Wallet (1 Member = 1 Wallet)
  await env.DB.prepare(`
    INSERT INTO wallets (member_id, balance, total_deposit, total_spent, created_at, updated_at)
    VALUES (?, 0.00, 0.00, 0.00, ?, ?)
  `).bind(memberId, now, now).run();

  // Insert tags if provided
  if (Array.isArray(tags) && tags.length > 0) {
    for (const tagItem of tags) {
      const tagStr = (typeof tagItem === 'string' ? tagItem : tagItem.tag || '').trim();
      if (tagStr) {
        await env.DB.prepare(`
          INSERT INTO customer_tags (member_id, tag, tag_name, status, created_at, updated_at)
          VALUES (?, ?, ?, 'ACTIVE', ?, ?)
        `).bind(memberId, tagStr.toUpperCase(), typeof tagItem === 'object' ? (tagItem.tagName || '') : '', now, now).run();
      }
    }
  }

  // Audit Log & Activity
  await env.DB.prepare(`
    INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
    VALUES (?, ?, 'CREATE_MEMBER', 'MEMBER', ?, NULL, ?, 'สร้างสมาชิกใหม่โดย Admin', ?)
  `).bind(
    adminUser.userId || null,
    adminUser.name || 'Admin',
    String(memberId),
    JSON.stringify({ username: trimmedUsername, phone: phone || '' }),
    now
  ).run();

  await env.DB.prepare(`
    INSERT INTO member_activities (member_id, activity_type, description, created_at)
    VALUES (?, 'REGISTER', 'สมัครสมาชิกใหม่ในระบบ', ?)
  `).bind(memberId, now).run();

  return new Response(JSON.stringify({
    success: true,
    message: 'สร้างสมาชิกสำเร็จ',
    memberId,
    memberCode: `#${String(memberId).padStart(6, '0')}`,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
