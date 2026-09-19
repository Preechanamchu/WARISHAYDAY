// functions/api/admin/member-registrations.js
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

  // Super Admin or Admin with member permission
  const user = auth.user;
  if (!user.isSuperAdmin && (!user.permissions || !user.permissions.member)) {
    return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลการสมัครสมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      return await handleGetRegistrations(request, env);
    }
    if (method === 'POST') {
      return await handleRegistrationAction(request, env, user);
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/member-registrations:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการประมวลผล', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetRegistrations(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'PENDING';

  let query = 'SELECT id, username, first_name, last_name, phone, status, created_at, updated_at FROM members';
  const params = [];

  if (status !== 'ALL') {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY id DESC';

  const stmt = params.length > 0 ? env.DB.prepare(query).bind(...params) : env.DB.prepare(query);
  const result = await stmt.all();
  const members = result.results || [];

  // Fetch tags for each member
  const registrations = await Promise.all(members.map(async (m) => {
    const tagsRes = await env.DB.prepare(
      'SELECT id, tag, tag_name, status FROM customer_tags WHERE member_id = ? ORDER BY id ASC'
    ).bind(m.id).all();

    return {
      id: m.id,
      username: m.username,
      firstName: m.first_name || '',
      lastName: m.last_name || '',
      phone: m.phone || '',
      status: m.status,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      tags: (tagsRes.results || []).map(t => ({
        id: t.id,
        tag: t.tag,
        tagName: t.tag_name,
        status: t.status
      }))
    };
  }));

  // Count pending
  const countRow = await env.DB.prepare("SELECT COUNT(*) as pending_count FROM members WHERE status = 'PENDING'").first();

  return new Response(JSON.stringify({
    success: true,
    pendingCount: countRow ? countRow.pending_count : 0,
    registrations: registrations
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleRegistrationAction(request, env, adminUser) {
  const body = await request.json();
  const { memberId, action, reason } = body;

  if (!memberId || !action) {
    return new Response(JSON.stringify({ error: 'กรุณาระบุ memberId และ action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
  if (!member) {
    return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลสมาชิกนี้' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date().toISOString();
  const adminId = adminUser.userId || 1;

  if (action === 'APPROVE') {
    if (member.status === 'ACTIVE') {
      return new Response(JSON.stringify({ error: 'สมาชิกรายนี้ได้รับการอนุมัติอยู่แล้ว' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update status to ACTIVE
    await env.DB.prepare('UPDATE members SET status = ?, updated_at = ? WHERE id = ?')
      .bind('ACTIVE', now, memberId).run();

    // Ensure wallet exists
    const wallet = await env.DB.prepare('SELECT id FROM wallets WHERE member_id = ?').bind(memberId).first();
    if (!wallet) {
      await env.DB.prepare(`
        INSERT INTO wallets (member_id, balance, total_deposit, total_spent, created_at, updated_at)
        VALUES (?, 0.00, 0.00, 0.00, ?, ?)
      `).bind(memberId, now, now).run();
    }

    // Insert audit log
    await env.DB.prepare(`
      INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
      VALUES (?, ?, 'APPROVE_MEMBER_REGISTRATION', 'MEMBER', ?, ?, ?, ?, ?)
    `).bind(
      adminId,
      adminUser.name || 'Admin',
      String(memberId),
      JSON.stringify({ status: member.status }),
      JSON.stringify({ status: 'ACTIVE' }),
      reason || 'อนุมัติการสมัครสมาชิก',
      now
    ).run();

    // Log member activity
    await env.DB.prepare(`
      INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
      VALUES (?, 'REGISTRATION_APPROVED', 'ผู้ดูแลระบบอนุมัติการสมัครสมาชิก', ?, ?)
    `).bind(
      memberId,
      JSON.stringify({ approvedBy: adminUser.name || `Admin #${adminId}`, reason: reason || '' }),
      now
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: `อนุมัติสมาชิก ${member.username} เรียบร้อยแล้ว`,
      memberId: memberId,
      status: 'ACTIVE'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } else if (action === 'REJECT') {
    // Update status to REJECTED
    await env.DB.prepare('UPDATE members SET status = ?, updated_at = ? WHERE id = ?')
      .bind('REJECTED', now, memberId).run();

    // Insert audit log
    await env.DB.prepare(`
      INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
      VALUES (?, ?, 'REJECT_MEMBER_REGISTRATION', 'MEMBER', ?, ?, ?, ?, ?)
    `).bind(
      adminId,
      adminUser.name || 'Admin',
      String(memberId),
      JSON.stringify({ status: member.status }),
      JSON.stringify({ status: 'REJECTED' }),
      reason || 'ปฏิเสธการสมัครสมาชิก',
      now
    ).run();

    // Log member activity
    await env.DB.prepare(`
      INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
      VALUES (?, 'REGISTRATION_REJECTED', 'ผู้ดูแลระบบปฏิเสธการสมัครสมาชิก', ?, ?)
    `).bind(
      memberId,
      JSON.stringify({ rejectedBy: adminUser.name || `Admin #${adminId}`, reason: reason || '' }),
      now
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: `ปฏิเสธการสมัครสมาชิกของ ${member.username} เรียบร้อยแล้ว`,
      memberId: memberId,
      status: 'REJECTED'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } else {
    return new Response(JSON.stringify({ error: `ไม่รองรับ action: ${action}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
