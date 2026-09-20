// functions/api/admin/member-statistics.js
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
    return new Response(JSON.stringify({ error: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลสมาชิก' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const chartTimeframe = url.searchParams.get('chartTimeframe') || '30days';
    const topTimeframe = url.searchParams.get('topTimeframe') || 'thisMonth';

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const todayStart = `${todayStr}T00:00:00.000Z`;

    // 1. Summary Cards Queries
    const [
      totalMembersRes,
      activeMembersRes,
      newTodayRes,
      totalCreditRes,
      ordersTodayRes,
      ordersMonthRes,
      topTodayRes,
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM members').first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'ACTIVE'").first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM members WHERE created_at >= ?').bind(todayStart).first(),
      env.DB.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM wallets').first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE timestamp >= ?
          AND (
            member_id IS NOT NULL 
            OR customer_tag IN (SELECT tag FROM customer_tags)
          )
      `).bind(todayStart).first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE timestamp >= ?
          AND (
            member_id IS NOT NULL 
            OR customer_tag IN (SELECT tag FROM customer_tags)
          )
      `).bind(thisMonthStart).first(),
      // Top order member today
      env.DB.prepare(`
        SELECT 
          m.id as member_id,
          m.username,
          m.first_name,
          m.last_name,
          COALESCE(w.balance, 0) as balance,
          COUNT(o.order_id) as order_count,
          COALESCE(SUM(o.total), 0) as order_total
        FROM members m
        LEFT JOIN wallets w ON w.member_id = m.id
        JOIN orders o ON (o.member_id = m.id OR o.customer_tag IN (SELECT tag FROM customer_tags ct WHERE ct.member_id = m.id))
        WHERE o.timestamp >= ?
        GROUP BY m.id
        ORDER BY order_total DESC
        LIMIT 1
      `).bind(todayStart).first()
    ]);

    // 2. Highlight Card (Top order member today)
    let topMemberToday = null;
    if (topTodayRes && topTodayRes.member_id) {
      topMemberToday = {
        memberId: topTodayRes.member_id,
        memberCode: `#${String(topTodayRes.member_id).padStart(6, '0')}`,
        username: topTodayRes.username,
        name: [topTodayRes.first_name, topTodayRes.last_name].filter(Boolean).join(' ') || topTodayRes.username,
        orderCount: topTodayRes.order_count || 0,
        orderTotal: Number(topTodayRes.order_total) || 0,
        remainingCredit: Number(topTodayRes.balance) || 0,
      };
    }

    // 3. Top 10 Members Query based on timeframe
    let topStartDate = thisMonthStart;
    if (topTimeframe === 'today') {
      topStartDate = todayStart;
    } else if (topTimeframe === '7days') {
      topStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (topTimeframe === '30days') {
      topStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (topTimeframe === 'thisYear') {
      topStartDate = `${now.getFullYear()}-01-01T00:00:00.000Z`;
    } else if (topTimeframe === 'all') {
      topStartDate = '1970-01-01T00:00:00.000Z';
    }

    const top10Res = await env.DB.prepare(`
      SELECT 
        m.id,
        m.username,
        m.first_name,
        m.last_name,
        COALESCE(w.balance, 0) as balance,
        (SELECT COUNT(*) FROM customer_tags ct WHERE ct.member_id = m.id) as tag_count,
        COUNT(o.order_id) as order_count,
        COALESCE(SUM(o.total), 0) as order_total
      FROM members m
      LEFT JOIN wallets w ON w.member_id = m.id
      JOIN orders o ON (o.member_id = m.id OR o.customer_tag IN (SELECT tag FROM customer_tags ct WHERE ct.member_id = m.id))
      WHERE o.timestamp >= ?
      GROUP BY m.id
      ORDER BY order_total DESC
      LIMIT 10
    `).bind(topStartDate).all();

    const top10Members = (top10Res.results || []).map((r, idx) => ({
      rank: idx + 1,
      memberId: r.id,
      memberCode: `#${String(r.id).padStart(6, '0')}`,
      username: r.username,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username,
      orderCount: r.order_count || 0,
      orderTotal: Number(r.order_total) || 0,
      remainingCredit: Number(r.balance) || 0,
      tagCount: r.tag_count || 0,
    }));

    // 4. Charts Data based on chartTimeframe
    let chartDays = 30;
    if (chartTimeframe === 'today') chartDays = 1;
    else if (chartTimeframe === '7days') chartDays = 7;
    else if (chartTimeframe === '30days') chartDays = 30;
    else if (chartTimeframe === 'thisMonth') {
      chartDays = now.getDate();
    } else if (chartTimeframe === 'thisYear') {
      chartDays = 365;
    }

    const chartStartDate = new Date(now.getTime() - (chartDays - 1) * 24 * 60 * 60 * 1000);
    chartStartDate.setHours(0, 0, 0, 0);

    const [membersHistoryRes, ordersHistoryRes] = await Promise.all([
      env.DB.prepare(`
        SELECT SUBSTR(created_at, 1, 10) as day, COUNT(*) as count
        FROM members
        WHERE created_at >= ?
        GROUP BY SUBSTR(created_at, 1, 10)
        ORDER BY day ASC
      `).bind(chartStartDate.toISOString()).all(),
      env.DB.prepare(`
        SELECT SUBSTR(timestamp, 1, 10) as day, COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE timestamp >= ?
          AND (member_id IS NOT NULL OR customer_tag IN (SELECT tag FROM customer_tags))
        GROUP BY SUBSTR(timestamp, 1, 10)
        ORDER BY day ASC
      `).bind(chartStartDate.toISOString()).all()
    ]);

    // Build day labels
    const labels = [];
    const memberCountsMap = {};
    const orderCountsMap = {};
    const orderTotalsMap = {};

    (membersHistoryRes.results || []).forEach(r => {
      memberCountsMap[r.day] = r.count;
    });

    (ordersHistoryRes.results || []).forEach(r => {
      orderCountsMap[r.day] = r.count;
      orderTotalsMap[r.day] = Number(r.total) || 0;
    });

    // Generate date sequence
    const curr = new Date(chartStartDate.getTime());
    while (curr <= now) {
      const dStr = curr.toISOString().slice(0, 10);
      labels.push(dStr);
      curr.setDate(curr.getDate() + 1);
    }

    const newMembersChartData = {
      labels,
      data: labels.map(d => memberCountsMap[d] || 0),
    };

    const memberOrdersChartData = {
      labels,
      orderCounts: labels.map(d => orderCountsMap[d] || 0),
      orderTotals: labels.map(d => orderTotalsMap[d] || 0),
    };

    return new Response(JSON.stringify({
      summaryCards: {
        totalMembers: totalMembersRes ? totalMembersRes.count : 0,
        activeMembers: activeMembersRes ? activeMembersRes.count : 0,
        newToday: newTodayRes ? newTodayRes.count : 0,
        totalCredit: Number(totalCreditRes?.total) || 0,
        ordersToday: Number(ordersTodayRes?.total) || 0,
        ordersMonth: Number(ordersMonthRes?.total) || 0,
      },
      highlightCard: topMemberToday,
      top10Members,
      newMembersChart: newMembersChartData,
      memberOrdersChart: memberOrdersChartData,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in admin/member-statistics:', error);
    return new Response(JSON.stringify({ error: 'เกิดข้อผิดพลาดในการโหลดสถิติ', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
