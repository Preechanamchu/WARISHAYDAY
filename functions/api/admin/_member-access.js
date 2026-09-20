// functions/api/admin/_member-access.js
// Shared authorization for Admin Member panel APIs
export function hasMemberAdminAccess(user) {
  if (!user || typeof user !== 'object') return false;

  // Customer members cannot access admin APIs
  if (user.role === 'member' || user.isMember) return false;

  // Super Admin check (boolean, number, string, role)
  if (
    user.isSuperAdmin === true ||
    user.isSuperAdmin === 1 ||
    user.isSuperAdmin === '1' ||
    user.is_super_admin === 1 ||
    user.is_super_admin === true ||
    user.is_super_admin === '1' ||
    user.role === 'super_admin' ||
    user.role === 'SUPER_ADMIN'
  ) {
    return true;
  }

  // Permissions check: if explicitly denied
  const permissions = user.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  if (permissions.member === false || permissions.member === 0 || permissions.member === 'false') {
    return false;
  }

  // If permissions.member is explicitly true
  if (permissions.member === true || permissions.member === 1 || permissions.member === 'true') {
    return true;
  }

  // Any authenticated admin/staff account (has userId, id, username, or name and not a customer member)
  // has access by default, matching frontend script.js behavior
  if (user.userId || user.id || user.username || user.name) {
    return true;
  }

  return false;
}
