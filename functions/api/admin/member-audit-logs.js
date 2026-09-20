// functions/api/admin/member-audit-logs.js
import { authenticateRequest } from '../_auth.js';
import { hasMemberAdminAccess } from './_member-access.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await authenticateRequest(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = auth.user;
  if (!hasMemberAdminAccess(user)) {
    return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึง Audit Logs' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'ALL';
    const search = (url.searchParams.get('search') || '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    let whereClauses = ['1=1'];
    let params = [];

    if (action !== 'ALL') {
      whereClauses.push('action = ?');
      params.push(action);
    }

    if (search) {
      const cleanSearch = `%${search.replace(/[%_]/g, '')}%`;
      whereClauses.push('(admin_name LIKE ? OR target_id LIKE ? OR reason LIKE ?)');
      params.push(cleanSearch, cleanSearch, cleanSearch);
    }

    const whereSql = whereClauses.join(' AND ');

    const countSql = `SELECT COUNT(*) as total FROM audit_logs WHERE ${whereSql}`;
    const countRes = await env.DB.prepare(countSql).bind(...params).first();
    const total = countRes ? countRes.total : 0;

    const querySql = `
      SELECT id, admin_id, admin_name, action, target_type, target_id, before_val, after_val, reason, ip, created_at
      FROM audit_logs
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await env.DB.prepare(querySql).bind(...params, limit, offset).all();

    return new Response(JSON.stringify({
      logs: rows.results || [],
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
  } catch (error) {
    console.error('Error in admin/member-audit-logs:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการโหลด Audit Logs', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
