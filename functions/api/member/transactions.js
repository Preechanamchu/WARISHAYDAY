// functions/api/member/transactions.js
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
    return new Response(JSON.stringify({ error: 'ไม่พบสิทธิ์สมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

    const res = await env.DB.prepare(`
      SELECT id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, description, status, created_at
      FROM wallet_transactions
      WHERE member_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).bind(memberId, limit).all();

    return new Response(JSON.stringify({
      success: true,
      transactions: res.results || []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error fetching member transactions:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลประวัติเครดิต: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
