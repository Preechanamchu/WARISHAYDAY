// functions/api/admin/credit-requests.js
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
    return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึงระบบเติมเครดิต' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      return await handleGetCreditRequests(request, env);
    }
    if (method === 'POST') {
      return await handleProcessCreditRequest(request, env, user);
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/credit-requests:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการประมวลผลคำขอเติมเครดิต', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetCreditRequests(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'ALL';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '15', 10)));
  const offset = (page - 1) * limit;

  let whereClauses = ['1=1'];
  let params = [];

  if (status !== 'ALL') {
    whereClauses.push('cd.status = ?');
    params.push(status.toUpperCase());
  }

  const whereSql = whereClauses.join(' AND ');

  const countSql = `SELECT COUNT(*) as total FROM credit_deposits cd WHERE ${whereSql}`;
  const countRes = await env.DB.prepare(countSql).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  const querySql = `
    SELECT 
      cd.id,
      cd.deposit_code,
      cd.member_id,
      cd.amount,
      cd.slip_url,
      cd.status,
      cd.admin_id,
      cd.approved_at,
      cd.rejected_at,
      cd.notes,
      cd.created_at,
      m.username,
      m.first_name,
      m.last_name,
      m.phone,
      COALESCE(w.balance, 0) as current_balance
    FROM credit_deposits cd
    LEFT JOIN members m ON m.id = cd.member_id
    LEFT JOIN wallets w ON w.member_id = cd.member_id
    WHERE ${whereSql}
    ORDER BY cd.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await env.DB.prepare(querySql).bind(...params, limit, offset).all();

  const requests = (rows.results || []).map(r => ({
    id: r.id,
    depositCode: r.deposit_code,
    memberId: r.member_id,
    memberCode: `#${String(r.member_id).padStart(6, '0')}`,
    username: r.username || '-',
    memberName: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || '-',
    phone: r.phone || '-',
    currentBalance: Number(r.current_balance) || 0,
    amount: Number(r.amount) || 0,
    slipUrl: r.slip_url,
    status: r.status,
    adminId: r.admin_id,
    approvedAt: r.approved_at,
    rejectedAt: r.rejected_at,
    notes: r.notes,
    createdAt: r.created_at,
  }));

  return new Response(JSON.stringify({
    requests,
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

async function handleProcessCreditRequest(request, env, adminUser) {
  const body = await request.json();
  const { depositId, action, notes } = body;

  if (!depositId || !action) {
    return new Response(JSON.stringify({ error: 'กรุณาระบุ depositId และ action (APPROVE หรือ REJECT)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const act = action.toUpperCase();
  if (act !== 'APPROVE' && act !== 'REJECT') {
    return new Response(JSON.stringify({ error: 'action ต้องเป็น APPROVE หรือ REJECT' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Check existing deposit strictly
  const deposit = await env.DB.prepare('SELECT * FROM credit_deposits WHERE id = ?').bind(depositId).first();
  if (!deposit) {
    return new Response(JSON.stringify({ error: 'ไม่พบคำขอเติมเครดิตนี้' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (deposit.status !== 'PENDING') {
    return new Response(JSON.stringify({ 
      error: `คำขอนี้ได้รับการดำเนินการไปแล้ว (${deposit.status}) ไม่สามารถทำรายการซ้ำได้` 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date().toISOString();
  const adminId = adminUser.userId || null;
  const adminName = adminUser.name || 'Admin';

  if (act === 'APPROVE') {
    // Fetch wallet
    let wallet = await env.DB.prepare('SELECT * FROM wallets WHERE member_id = ?').bind(deposit.member_id).first();
    if (!wallet) {
      await env.DB.prepare('INSERT INTO wallets (member_id, balance, total_deposit, total_spent, created_at, updated_at) VALUES (?, 0, 0, 0, ?, ?)')
        .bind(deposit.member_id, now, now).run();
      wallet = { id: 0, balance: 0, total_deposit: 0, total_spent: 0 };
    }

    const balanceBefore = Number(wallet.balance) || 0;
    const depositAmount = Number(deposit.amount) || 0;
    const balanceAfter = balanceBefore + depositAmount;
    const newTotalDeposit = (Number(wallet.total_deposit) || 0) + depositAmount;
    const txCode = `CRD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    // Atomic D1 Batch Execution
    const batchOps = [
      // 1. Update deposit status
      env.DB.prepare(`
        UPDATE credit_deposits 
        SET status = 'APPROVED', admin_id = ?, approved_at = ?, notes = ? 
        WHERE id = ? AND status = 'PENDING'
      `).bind(adminId, now, notes || 'อนุมัติการเติมเงินผ่านสลิป', depositId),

      // 2. Update wallet balance
      env.DB.prepare(`
        UPDATE wallets 
        SET balance = ?, total_deposit = ?, updated_at = ? 
        WHERE member_id = ?
      `).bind(balanceAfter, newTotalDeposit, now, deposit.member_id),

      // 3. Create wallet transaction ledger
      env.DB.prepare(`
        INSERT INTO wallet_transactions 
        (transaction_code, wallet_id, member_id, type, amount, balance_before, balance_after, reference, admin_id, status, note, created_at)
        VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
      `).bind(
        txCode,
        wallet.id || 1,
        deposit.member_id,
        depositAmount,
        balanceBefore,
        balanceAfter,
        deposit.deposit_code,
        adminId,
        notes || 'เติมเงินผ่านสลิป',
        now
      ),

      // 4. Audit Log
      env.DB.prepare(`
        INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
        VALUES (?, ?, 'APPROVE_DEPOSIT', 'DEPOSIT', ?, ?, ?, ?, ?)
      `).bind(
        adminId,
        adminName,
        String(depositId),
        JSON.stringify({ status: 'PENDING', balance: balanceBefore }),
        JSON.stringify({ status: 'APPROVED', amount: depositAmount, balance: balanceAfter }),
        notes || 'อนุมัติการเติมเครดิต',
        now
      ),

      // 5. Member Activity
      env.DB.prepare(`
        INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
        VALUES (?, 'DEPOSIT', ?, ?, ?)
      `).bind(
        deposit.member_id,
        `เติมเครดิตสำเร็จ ฿${depositAmount.toLocaleString()}`,
        JSON.stringify({ depositCode: deposit.deposit_code, amount: depositAmount, balanceAfter }),
        now
      )
    ];

    const results = await env.DB.batch(batchOps);

    // Verify row change in step 1 to guarantee atomicity
    if (results[0].meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาด คำขอนี้อาจถูกอนุมัติไปแล้วโดยผู้ดูแลอื่น' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `อนุมัติคำขอเติมเงินเรียบร้อยแล้ว เพิ่มเครดิต ฿${depositAmount.toLocaleString()}`,
      balanceAfter,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (act === 'REJECT') {
    const batchOps = [
      env.DB.prepare(`
        UPDATE credit_deposits 
        SET status = 'REJECTED', admin_id = ?, rejected_at = ?, notes = ? 
        WHERE id = ? AND status = 'PENDING'
      `).bind(adminId, now, notes || 'ปฏิเสธคำขอเติมเงิน', depositId),

      env.DB.prepare(`
        INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, created_at)
        VALUES (?, ?, 'REJECT_DEPOSIT', 'DEPOSIT', ?, ?, ?, ?, ?)
      `).bind(
        adminId,
        adminName,
        String(depositId),
        JSON.stringify({ status: 'PENDING' }),
        JSON.stringify({ status: 'REJECTED' }),
        notes || 'ปฏิเสธคำขอเติมเครดิต',
        now
      ),

      env.DB.prepare(`
        INSERT INTO member_activities (member_id, activity_type, description, metadata, created_at)
        VALUES (?, 'DEPOSIT_REJECTED', ?, ?, ?)
      `).bind(
        deposit.member_id,
        `คำขอเติมเครดิต ฿${Number(deposit.amount).toLocaleString()} ถูกปฏิเสธ: ${notes || 'สลิปไม่ถูกต้อง'}`,
        JSON.stringify({ depositCode: deposit.deposit_code, reason: notes || '' }),
        now
      )
    ];

    const results = await env.DB.batch(batchOps);
    if (results[0].meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาด คำขอนี้อาจถูกดำเนินการไปแล้ว' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'ปฏิเสธคำขอเติมเงินเรียบร้อยแล้ว',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
