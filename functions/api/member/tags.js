// functions/api/member/tags.js
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

  const memberId = auth.user.memberId;
  if (!memberId) {
    return new Response(JSON.stringify({ error: 'ไม่พบสิทธิ์สมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      const res = await env.DB.prepare(
        'SELECT id, tag, tag_name, status, created_at FROM customer_tags WHERE member_id = ? AND status = "ACTIVE" ORDER BY id ASC'
      ).bind(memberId).all();

      return new Response(JSON.stringify({
        success: true,
        tags: res.results || []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST') {
      // Add new tag
      const body = await request.json();
      const { tag, tagName } = body;

      const cleanTag = String(tag || '').trim().replace(/^#/, '').toUpperCase();
      if (!cleanTag) {
        return new Response(JSON.stringify({ error: 'กรุณาระบุ Hay Day Player Tag' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check current tag count
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) as tag_count FROM customer_tags WHERE member_id = ? AND status = "ACTIVE"'
      ).bind(memberId).first();

      if (countRow && countRow.tag_count >= 10) {
        return new Response(JSON.stringify({ error: 'สามารถเพิ่มแท็กได้สูงสุดไม่เกิน 10 แท็ก' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check if tag already exists for this member
      const exists = await env.DB.prepare(
        'SELECT id FROM customer_tags WHERE member_id = ? AND UPPER(tag) = ? AND status = "ACTIVE"'
      ).bind(memberId, cleanTag).first();

      if (exists) {
        return new Response(JSON.stringify({ error: 'คุณมีแท็กนี้อยู่ในระบบแล้ว' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const now = new Date().toISOString();
      const finalTagName = (tagName || '').trim() || `ฟาร์มสำรอง ${(countRow?.tag_count || 0) + 1}`;

      const insertRes = await env.DB.prepare(`
        INSERT INTO customer_tags (member_id, tag, tag_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?)
      `).bind(memberId, cleanTag, finalTagName, now, now).run();

      return new Response(JSON.stringify({
        success: true,
        message: `เพิ่มแท็ก #${cleanTag} สำเร็จ`,
        tag: {
          id: insertRes.meta.last_row_id,
          tag: cleanTag,
          tagName: finalTagName,
          status: 'ACTIVE'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const tagId = url.searchParams.get('id');

      if (!tagId) {
        return new Response(JSON.stringify({ error: 'กรุณาระบุ tagId ที่ต้องการลบ' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check remaining tags
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) as tag_count FROM customer_tags WHERE member_id = ? AND status = "ACTIVE"'
      ).bind(memberId).first();

      if (countRow && countRow.tag_count <= 1) {
        return new Response(JSON.stringify({ error: 'ต้องมีแท็กฟาร์มอย่างน้อย 1 แท็ก ไม่สามารถลบได้' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await env.DB.prepare(
        'DELETE FROM customer_tags WHERE id = ? AND member_id = ?'
      ).bind(tagId, memberId).run();

      return new Response(JSON.stringify({
        success: true,
        message: 'ลบแท็กเรียบร้อยแล้ว'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Error in member tags API:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาด: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
