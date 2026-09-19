// functions/api/login.js
import bcrypt from 'bcryptjs';
import { signJwt } from './_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trimmedUser = String(username).trim();
    const result = await env.DB.prepare('SELECT * FROM users WHERE TRIM(username) = ?')
      .bind(trimmedUser)
      .all();

    if (!result.results || result.results.length === 0) {
      // Check members table
      const member = await env.DB.prepare('SELECT * FROM members WHERE LOWER(TRIM(username)) = LOWER(?)')
        .bind(trimmedUser)
        .first();

      if (member && member.password_hash) {
        const memberMatch = await bcrypt.compare(password, member.password_hash);
        if (memberMatch) {
          if (member.status !== 'ACTIVE') {
            return new Response(JSON.stringify({ error: 'บัญชีสมาชิกนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const nowIso = new Date().toISOString();
          await env.DB.prepare('UPDATE members SET last_login_at = ? WHERE id = ?').bind(nowIso, member.id).run();

          const secretKey = env.JWT_SECRET || 'warishayday_super_secret_jwt_key_2025_secure';
          const memberName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.username;
          const token = await signJwt(
            {
              memberId: member.id,
              username: member.username,
              name: memberName,
              role: 'member',
              isSuperAdmin: false,
              permissions: {},
            },
            secretKey,
            86400
          );

          return new Response(JSON.stringify({
            message: 'Login successful',
            token,
            isMember: true,
            member: {
              id: member.id,
              username: member.username,
              name: memberName,
              phone: member.phone,
            },
            user: {
              name: memberName,
              isSuperAdmin: false,
              permissions: {},
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = result.results[0];

    if (!user.pin_hash) {
      return new Response(JSON.stringify({ error: 'User account corrupted (no password set)' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const match = await bcrypt.compare(password, user.pin_hash);

    if (!match) {
      return new Response(JSON.stringify({ error: 'Invalid username or password (Password mismatch)' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '{}') : (user.permissions || {});
    const isSuperAdmin = Boolean(user.is_super_admin);

    const secretKey = env.JWT_SECRET || 'warishayday_super_secret_jwt_key_2025_secure';
    const token = await signJwt(
      {
        userId: user.id,
        name: user.name,
        isSuperAdmin: isSuperAdmin,
        permissions: permissions,
      },
      secretKey,
      86400 // 1 day
    );

    return new Response(JSON.stringify({
      message: 'Login successful',
      token,
      user: {
        name: user.name,
        isSuperAdmin: isSuperAdmin,
        permissions: permissions,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({
      error: 'An internal server error occurred.',
      details: error.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
