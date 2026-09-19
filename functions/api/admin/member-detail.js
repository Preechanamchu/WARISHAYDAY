// functions/api/admin/member-detail.js
import bcrypt from 'bcryptjs';
import { authenticateRequest } from '../_auth.js';

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

  const user = auth.user;
  if (!user.isSuperAdmin && (!user.permissions || !user.permissions.member)) {
    return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลสมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      return await handleGetMemberDetail(request, env);
    }
    if (method === 'PATCH' || method === 'PUT') {
      return await handleUpdateMember(request, env, user);
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/member-detail:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการประมวลผลข้อมูลสมาชิก', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetMemberDetail(request, env) {
  const url = new URL(request.url);
  const idStr = url.searchParams.get('id');
  const id = parseInt(idStr, 10);

  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ error: 'กรุณาระบุ Member ID ที่ถูกต้อง' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Fetch Member
  const member = await env.DB.prepare(`
    SELECT id, username, first_name, last_name, phone, status, created_at, last_login_at, updated_at
    FROM members WHERE id = ?
  `).bind(id).first();

  if (!member) {
    return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลสมาชิก' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Fetch Wallet
  let wallet = await env.DB.prepare('SELECT id, balance, total_deposit, total_spent FROM wallets WHERE member_id = ?').bind(id).first();
  if (!wallet) {
    // If not exists, initialize
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO wallets (member_id, balance, total_deposit, total_spent, created_at, updated_at) VALUES (?, 0, 0, 0, ?, ?)')
      .bind(id, now, now).run();
    wallet = { id: 0, balance: 0, total_deposit: 0, total_spent: 0 };
  }

  // 3. Fetch Tags
  const tagsRes = await env.DB.prepare('SELECT id, tag, tag_name, status, created_at FROM customer_tags WHERE member_id = ? ORDER BY id ASC').bind(id).all();
  const tags = tagsRes.results || [];
  const tagStrings = tags.map(t => t.tag);

  // 4. Fetch Orders (linked by member_id or tag in customer_tags)
  let ordersQuery = 'SELECT * FROM orders WHERE member_id = ?';
  let orderParams = [id];

  if (tagStrings.length > 0) {
    const placeholders = tagStrings.map(() => '?').join(', ');
    ordersQuery = `SELECT * FROM orders WHERE member_id = ? OR customer_tag IN (${placeholders}) ORDER BY timestamp DESC LIMIT 100`;
    orderParams = [id, ...tagStrings];
  } else {
    ordersQuery += ' ORDER BY timestamp DESC LIMIT 100';
  }

  const ordersRes = await env.DB.prepare(ordersQuery).bind(...orderParams).all();
  const orders = (ordersRes.results || []).map(o => {
    let items = {};
    try {
      items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || {});
    } catch (e) {
      items = {};
    }
    const itemCount = Array.isArray(items) ? items.reduce((sum, it) => sum + (it.quantity || 1), 0) : Object.keys(items).length;
    return {
      orderId: o.order_id,
      timestamp: o.timestamp,
      tag: o.customer_tag || '-',
      items: items,
      itemCount: itemCount,
      total: Number(o.total) || 0,
      creditBefore: o.credit_before !== null ? Number(o.credit_before) : null,
      creditAfter: o.credit_after !== null ? Number(o.credit_after) : null,
      paymentMethod: o.payment_method || 'PROMPTPAY',
      status: o.status,
    };
  });

  // 5. Fetch Wallet Transactions
  const txRes = await env.DB.prepare(`
    SELECT id, transaction_code, type, amount, balance_before, balance_after, reference, admin_id, status, note, created_at
    FROM wallet_transactions
    WHERE member_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(id).all();

  // 6. Fetch Member Activities
  const actRes = await env.DB.prepare(`
    SELECT id, activity_type, description, metadata, ip, created_at
    FROM member_activities
    WHERE member_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(id).all();

  return new Response(JSON.stringify({
    member: {
      ...member,
      memberCode: `#${String(member.id).padStart(6, '0')}`,
      fullName: [member.first_name, member.last_name].filter(Boolean).join(' ') || '-',
    },
    wallet: {
      balance: Number(wallet.balance) || 0,
      totalDeposit: Number(wallet.total_deposit) || 0,
      totalSpent: Number(wallet.total_spent) || 0,
    },
    tags,
    orders,
    transactions: txRes.results || [],
    activities: actRes.results || [],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleUpdateMember(request, env, adminUser) {
  const body = await request.json();
  const { id, firstName, lastName, phone, status, password } = body;

  if (!id) {
    return new Response(JSON.stringify({ error: 'Member ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'ไม่พบสมาชิกนี้ในระบบ' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const values = [now];
  const changes = {};

  if (firstName !== undefined) {
    fields.push('first_name = ?');
    values.push(firstName.trim());
    if (existing.first_name !== firstName.trim()) changes.firstName = { before: existing.first_name, after: firstName.trim() };
  }
  if (lastName !== undefined) {
    fields.push('last_name = ?');
    values.push(lastName.trim());
    if (existing.last_name !== lastName.trim()) changes.lastName = { before: existing.last_name, after: lastName.trim() };
  }
  if (phone !== undefined) {
    fields.push('phone = ?');
    values.push(phone.trim());
    if (existing.phone !== phone.trim()) changes.phone = { before: existing.phone, after: phone.trim() };
  }
  if (status !== undefined) {
    const validStatuses = ['ACTIVE', 'SUSPENDED', 'DISABLED'];
    if (!validStatuses.includes(status.toUpperCase())) {
      return new Response(JSON.stringify({ error: 'สถานะไม่ถูกต้อง (ACTIVE, SUSPENDED, DISABLED)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    fields.push('status = ?');
    values.push(status.toUpperCase());
    if (existing.status !== status.toUpperCase()) changes.status = { before: existing.status, after: status.toUpperCase() };
  }
  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    fields.push('password_hash = ?');
    values.push(passwordHash);
    changes.password = 'CHANGED';
  }

  values.push(id);
  await env.DB.prepare(`UPDATE members SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  // Record Audit Log & Member Activity
  if (Object.keys(changes).length > 0) {
    await env.DB.prepare(`
      INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
      VALUES (?, ?, 'UPDATE_MEMBER', 'MEMBER', ?, ?, ?, 'Admin อัปเดตข้อมูลสมาชิก', ?)
    `).bind(
      adminUser.userId || null,
      adminUser.name || 'Admin',
      String(id),
      JSON.stringify(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before || '']))),
      JSON.stringify(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after || v]))),
      now
    ).run();

    await env.DB.prepare(`
      INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
      VALUES (?, 'ADMIN_EDIT', 'Admin แก้ไขข้อมูลสมาชิก', ?, ?)
    `).bind(id, JSON.stringify(changes), now).run();
  }

  return new Response(JSON.stringify({
    success: true,
    message: 'อัปเดตข้อมูลสมาชิกสำเร็จ',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
