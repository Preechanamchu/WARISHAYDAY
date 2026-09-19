// functions/api/member/profile.js
import bcrypt from 'bcryptjs';
import { authenticateRequest } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const memberId = auth.user.memberId;
  if (!memberId) {
    return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลสมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const member = await env.DB.prepare(`
      SELECT id, username, first_name, last_name, phone, status, created_at, last_login_at
      FROM members WHERE id = ?
    `).bind(memberId).first();

    if (!member) {
      return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลสมาชิกนี้ในระบบ' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (member.status !== 'ACTIVE') {
      return new Response(JSON.stringify({ error: 'บัญชีสมาชิกนี้ไม่สามารถใช้งานได้' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get wallet
    let wallet = await env.DB.prepare(`
      SELECT balance, total_deposit, total_spent FROM wallets WHERE member_id = ?
    `).bind(memberId).first();

    if (!wallet) {
      wallet = { balance: 0.00, total_deposit: 0.00, total_spent: 0.00 };
    }

    // Get customer tags
    const tagsRes = await env.DB.prepare(`
      SELECT id, tag, tag_name, status FROM customer_tags WHERE member_id = ? AND status = 'ACTIVE' ORDER BY id ASC
    `).bind(memberId).all();

    // Get order count
    const ordersCountRow = await env.DB.prepare(`
      SELECT COUNT(*) as order_count FROM orders WHERE member_id = ?
    `).bind(memberId).first();

    return new Response(JSON.stringify({
      success: true,
      member: {
        id: member.id,
        memberIdStr: `#${String(member.id).padStart(6, '0')}`,
        username: member.username,
        firstName: member.first_name || '',
        lastName: member.last_name || '',
        name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.username,
        phone: member.phone || '',
        status: member.status,
        createdAt: member.created_at,
        lastLoginAt: member.last_login_at,
        orderCount: ordersCountRow ? ordersCountRow.order_count : 0,
        wallet: {
          balance: Number(wallet.balance) || 0,
          totalDeposit: Number(wallet.total_deposit) || 0,
          totalSpent: Number(wallet.total_spent) || 0,
        },
        tags: (tagsRes.results || []).map(t => ({
          id: t.id,
          tag: t.tag,
          tagName: t.tag_name || 'ฟาร์ม',
          status: t.status
        }))
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error fetching member profile:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const memberId = auth.user.memberId;
  if (!memberId) {
    return new Response(JSON.stringify({ error: 'ไม่พบสิทธิ์สมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { action, firstName, lastName, phone, currentPassword, newPassword } = body;
    const now = new Date().toISOString();

    if (action === 'CHANGE_PASSWORD') {
      if (!currentPassword || !newPassword) {
        return new Response(JSON.stringify({ error: 'กรุณากรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (String(newPassword).length < 6) {
        return new Response(JSON.stringify({ error: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const member = await env.DB.prepare('SELECT password_hash FROM members WHERE id = ?').bind(memberId).first();
      if (!member || !member.password_hash) {
        return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลสมาชิก' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const match = await bcrypt.compare(currentPassword, member.password_hash);
      if (!match) {
        return new Response(JSON.stringify({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await env.DB.prepare('UPDATE members SET password_hash = ?, updated_at = ? WHERE id = ?')
        .bind(newHash, now, memberId).run();

      await env.DB.prepare(`
        INSERT INTO member_activities (member_id, activity_type, description, created_at)
        VALUES (?, 'CHANGE_PASSWORD', 'เปลี่ยนรหัสผ่านสำเร็จ', ?)
      `).bind(memberId, now).run();

      return new Response(JSON.stringify({ success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } else {
      // Update profile info
      await env.DB.prepare(`
        UPDATE members SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?
      `).bind(
        (firstName || '').trim(),
        (lastName || '').trim(),
        (phone || '').trim(),
        now,
        memberId
      ).run();

      await env.DB.prepare(`
        INSERT INTO member_activities (member_id, activity_type, description, created_at)
        VALUES (?, 'UPDATE_PROFILE', 'แก้ไขข้อมูลส่วนตัว', ?)
      `).bind(memberId, now).run();

      return new Response(JSON.stringify({ success: true, message: 'บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (err) {
    console.error('Error updating member profile:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
