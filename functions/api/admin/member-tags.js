// functions/api/admin/member-tags.js
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
    if (method === 'POST') {
      return await handleAddTag(request, env, user);
    }
    if (method === 'PATCH') {
      return await handleUpdateTag(request, env, user);
    }
    if (method === 'DELETE') {
      return await handleDeleteTag(request, env, user);
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/member-tags:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการจัดการแท็ก', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleAddTag(request, env, adminUser) {
  const body = await request.json();
  const { memberId, tag, tagName } = body;

  if (!memberId || !tag) {
    return new Response(JSON.stringify({ error: 'กรุณาระบุ Member ID และ Tag' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cleanTag = String(tag).trim().toUpperCase();
  const now = new Date().toISOString();

  // Check if tag already exists for this member
  const existing = await env.DB.prepare('SELECT id FROM customer_tags WHERE member_id = ? AND UPPER(tag) = ?')
    .bind(memberId, cleanTag).first();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Tag นี้มีอยู่ในสมาชิกรายนี้แล้ว' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await env.DB.prepare(`
    INSERT INTO customer_tags (member_id, tag, tag_name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'ACTIVE', ?, ?)
  `).bind(memberId, cleanTag, (tagName || '').trim(), now, now).run();

  const tagId = res.meta.last_row_id;

  // Audit Log & Activity
  await env.DB.prepare(`
    INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, after_val, reason, created_at)
    VALUES (?, ?, 'ADD_TAG', 'TAG', ?, ?, 'Admin เพิ่มแท็กให้สมาชิก', ?)
  `).bind(adminUser.userId || null, adminUser.name || 'Admin', String(tagId), JSON.stringify({ memberId, tag: cleanTag }), now).run();

  await env.DB.prepare(`
    INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
    VALUES (?, 'ADD_TAG', ?, ?, ?)
  `).bind(memberId, `เพิ่มแท็ก ${cleanTag}`, JSON.stringify({ tagId, tag: cleanTag }), now).run();

  return new Response(JSON.stringify({
    success: true,
    message: 'เพิ่มแท็กสำเร็จ',
    tag: { id: tagId, member_id: memberId, tag: cleanTag, tag_name: tagName || '', status: 'ACTIVE', created_at: now }
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleUpdateTag(request, env, adminUser) {
  const body = await request.json();
  const { tagId, status, tagName, tag } = body;

  if (!tagId) {
    return new Response(JSON.stringify({ error: 'Tag ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = await env.DB.prepare('SELECT * FROM customer_tags WHERE id = ?').bind(tagId).first();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'ไม่พบแท็กนี้' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const values = [now];

  if (status !== undefined) {
    fields.push('status = ?');
    values.push(status.toUpperCase());
  }
  if (tagName !== undefined) {
    fields.push('tag_name = ?');
    values.push(tagName.trim());
  }
  if (tag !== undefined) {
    fields.push('tag = ?');
    values.push(tag.trim().toUpperCase());
  }

  values.push(tagId);
  await env.DB.prepare(`UPDATE customer_tags SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  // Audit log & Activity
  await env.DB.prepare(`
    INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
    VALUES (?, ?, 'UPDATE_TAG', 'TAG', ?, ?, ?, 'Admin แก้ไขแท็ก', ?)
  `).bind(
    adminUser.userId || null,
    adminUser.name || 'Admin',
    String(tagId),
    JSON.stringify(existing),
    JSON.stringify(body),
    now
  ).run();

  await env.DB.prepare(`
    INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
    VALUES (?, 'UPDATE_TAG', ?, ?, ?)
  `).bind(existing.member_id, `แก้ไขแท็ก ${existing.tag}`, JSON.stringify(body), now).run();

  return new Response(JSON.stringify({
    success: true,
    message: 'แก้ไขแท็กสำเร็จ',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleDeleteTag(request, env, adminUser) {
  const url = new URL(request.url);
  const tagId = url.searchParams.get('tagId') || url.searchParams.get('id');

  if (!tagId) {
    return new Response(JSON.stringify({ error: 'Tag ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = await env.DB.prepare('SELECT * FROM customer_tags WHERE id = ?').bind(tagId).first();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'ไม่พบแท็กนี้' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await env.DB.prepare('DELETE FROM customer_tags WHERE id = ?').bind(tagId).run();

  const now = new Date().toISOString();
  // Audit log & Activity
  await env.DB.prepare(`
    INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, reason, created_at)
    VALUES (?, ?, 'DELETE_TAG', 'TAG', ?, ?, 'Admin ลบแท็ก', ?)
  `).bind(adminUser.userId || null, adminUser.name || 'Admin', String(tagId), JSON.stringify(existing), now).run();

  await env.DB.prepare(`
    INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
    VALUES (?, 'REMOVE_TAG', ?, ?, ?)
  `).bind(existing.member_id, `ลบแท็ก ${existing.tag}`, JSON.stringify(existing), now).run();

  return new Response(JSON.stringify({
    success: true,
    message: 'ลบแท็กสำเร็จ',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
