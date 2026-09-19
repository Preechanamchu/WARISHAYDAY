// functions/api/member/credit-deposit.js
import { authenticateRequest } from '../_auth.js';

export async function onRequestPost(context) {
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
    const { amount, slipUrl, notes } = body;

    const depositAmount = Number(amount);
    if (!depositAmount || isNaN(depositAmount) || depositAmount <= 0) {
      return new Response(JSON.stringify({ error: 'กรุณาระบุจำนวนเงินที่ถูกต้อง (มากกว่า 0)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!slipUrl) {
      return new Response(JSON.stringify({ error: 'กรุณาแนบรูปภาพสลิปการโอนเงิน' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();
    const datePrefix = now.slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const depositCode = `DEP-${datePrefix}-${randomSuffix}`;

    const insertRes = await env.DB.prepare(`
      INSERT INTO credit_deposits (deposit_code, member_id, amount, slip_url, status, notes, created_at)
      VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
    `).bind(
      depositCode,
      memberId,
      depositAmount,
      slipUrl,
      notes || '',
      now
    ).run();

    // Log member activity
    await env.DB.prepare(`
      INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
      VALUES (?, 'TOPUP_REQUEST', ?, ?, ?)
    `).bind(
      memberId,
      `แจ้งเติมเครดิต ฿${depositAmount.toLocaleString()} (${depositCode})`,
      JSON.stringify({ depositCode, amount: depositAmount }),
      now
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'ส่งคำขอเติมเครดิตเรียบร้อยแล้ว กรุณารอแอดมินตรวจสอบสลิปและอนุมัติ',
      depositCode: depositCode,
      amount: depositAmount
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Error in credit-deposit:', err);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการส่งคำขอเติมเงิน: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
