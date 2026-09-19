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
      return new Response(JSON.stringify({ error: 'Invalid username or password (User not found)' }), {
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
