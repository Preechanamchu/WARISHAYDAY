// functions/api/member-register.js
import bcrypt from 'bcryptjs';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { username, password, firstName, lastName, phone, tag } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'กรุณากรอก Username และ Password ให้ครบถ้วน' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trimmedUsername = String(username).trim();
    if (trimmedUsername.length < 3) {
      return new Response(JSON.stringify({ error: 'Username ต้องมีความยาวอย่างน้อย 3 ตัวอักษร' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (String(password).length < 6) {
      return new Response(JSON.stringify({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if username already exists in members
    const existingMember = await env.DB.prepare('SELECT id FROM members WHERE LOWER(username) = LOWER(?)')
      .bind(trimmedUsername)
      .first();

    if (existingMember) {
      return new Response(JSON.stringify({ error: 'Username นี้มีผู้ใช้งานแล้ว กรุณาเลือกชื่ออื่น' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if username exists in users (admin/staff)
    const existingUser = await env.DB.prepare('SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?)')
      .bind(trimmedUsername)
      .first();

    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Username นี้ไม่สามารถใช้งานได้ กรุณาเลือกชื่ออื่น' }), {
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

    // Create member wallet (1 member = 1 wallet)
    await env.DB.prepare(`
      INSERT INTO wallets (member_id, balance, total_deposit, total_spent, created_at, updated_at)
      VALUES (?, 0.00, 0.00, 0.00, ?, ?)
    `).bind(memberId, now, now).run();

    // Insert tag if provided
    const cleanTag = (tag || '').trim().replace(/^#/, '');
    if (cleanTag) {
      await env.DB.prepare(`
        INSERT INTO customer_tags (member_id, tag, tag_name, status, created_at, updated_at)
        VALUES (?, ?, 'ฟาร์มหลัก', 'ACTIVE', ?, ?)
      `).bind(memberId, cleanTag.toUpperCase(), now, now).run();
    }

    // Log activity
    await env.DB.prepare(`
      INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
      VALUES (?, 'REGISTER', 'สมัครสมาชิกผ่านหน้าเว็บไซต์', ?, ?)
    `).bind(memberId, JSON.stringify({ ip: request.headers.get('cf-connecting-ip') || 'unknown' }), now).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'สมัครสมาชิกสำเร็จ! ท่านสามารถเข้าสู่ระบบได้ทันที',
      memberId: memberId,
      username: trimmedUsername,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Registration error:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการสมัครสมาชิก: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
