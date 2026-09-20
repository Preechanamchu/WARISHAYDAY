// functions/api/admin/credit-adjustment.js
import { authenticateRequest } from '../_auth.js';
import { hasMemberAdminAccess } from './_member-access.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = auth.user;
  // Super Admin or admin with member permission
  if (!hasMemberAdminAccess(user)) {
    return new Response(JSON.stringify({ error: 'เฉพาะ Super Admin หรือผู้ดูแลระบบที่มีสิทธิ์เท่านั้นที่สามารถปรับเครดิตได้' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { memberId, amount, type, reason } = body;

    if (!memberId) {
      return new Response(JSON.stringify({ error: 'กรุณาระบุ Member ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return new Response(JSON.stringify({ error: 'จำนวนเงินต้องมากกว่า 0' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      return new Response(JSON.stringify({ error: 'ต้องระบุเหตุผลในการปรับเครดิตทุกครั้ง' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adjType = String(type || 'ADD').toUpperCase();
    if (adjType !== 'ADD' && adjType !== 'DEDUCT') {
      return new Response(JSON.stringify({ error: 'ประเภทการปรับต้องเป็น ADD หรือ DEDUCT' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch member & wallet
    const member = await env.DB.prepare('SELECT id, username, status FROM members WHERE id = ?').bind(memberId).first();
    if (!member) {
      return new Response(JSON.stringify({ error: 'ไม่พบสมาชิกนี้ในระบบ' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();
    let wallet = await env.DB.prepare('SELECT * FROM wallets WHERE member_id = ?').bind(memberId).first();
    if (!wallet) {
      await env.DB.prepare('INSERT INTO wallets (member_id, balance, total_deposit, total_spent, created_at, updated_at) VALUES (?, 0, 0, 0, ?, ?)')
        .bind(memberId, now, now).run();
      wallet = { id: 0, balance: 0, total_deposit: 0, total_spent: 0 };
    }

    const balanceBefore = Number(wallet.balance) || 0;
    const delta = adjType === 'ADD' ? numAmount : -numAmount;
    const balanceAfter = balanceBefore + delta;

    // Credit CANNOT be negative!
    if (balanceAfter < 0) {
      return new Response(JSON.stringify({ 
        error: `ยอดเครดิตคงเหลือไม่เพียงพอ (คงเหลือ ฿${balanceBefore.toLocaleString()}, ต้องการลด ฿${numAmount.toLocaleString()}) เครดิตไม่สามารถติดลบได้` 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const txCode = `ADJ-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const adminId = user.userId || null;
    const adminName = user.name || 'Super Admin';

    // Atomic D1 Batch
    const batchOps = [
      env.DB.prepare(`
        UPDATE wallets 
        SET balance = ?, updated_at = ? 
        WHERE member_id = ?
      `).bind(balanceAfter, now, memberId),

      env.DB.prepare(`
        INSERT INTO wallet_transactions 
        (transaction_code, wallet_id, member_id, type, amount, balance_before, balance_after, reference, admin_id, status, note, created_at)
        VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
      `).bind(
        txCode,
        wallet.id || 1,
        memberId,
        delta,
        balanceBefore,
        balanceAfter,
        trimmedReason,
        adminId,
        `ปรับโดย ${adminName}: ${trimmedReason}`,
        now
      ),

      env.DB.prepare(`
        INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
        VALUES (?, ?, 'ADJUST_CREDIT', 'WALLET', ?, ?, ?, ?, ?)
      `).bind(
        adminId,
        adminName,
        String(memberId),
        JSON.stringify({ balance: balanceBefore }),
        JSON.stringify({ balance: balanceAfter, delta, type: adjType }),
        trimmedReason,
        now
      ),

      env.DB.prepare(`
        INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
        VALUES (?, 'ADMIN_ADJUST_CREDIT', ?, ?, ?)
      `).bind(
        memberId,
        `Admin ปรับเครดิต ${adjType === 'ADD' ? '+' : '-'}฿${numAmount.toLocaleString()} (${trimmedReason})`,
        JSON.stringify({ balanceBefore, balanceAfter, delta, reason: trimmedReason }),
        now
      )
    ];

    await env.DB.batch(batchOps);

    return new Response(JSON.stringify({
      success: true,
      message: `ปรับยอดเครดิตสำเร็จ ${adjType === 'ADD' ? '+' : '-'}฿${numAmount.toLocaleString()}`,
      balanceBefore,
      balanceAfter,
      transactionCode: txCode,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/credit-adjustment:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการปรับเครดิต', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
