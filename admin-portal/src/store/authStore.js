'use strict';

/**
 * Tab-Isolated & Role-Scoped Auth Store for SITAM Admin / Guard / Staff Portals
 * 
 * Architecture:
 * 1. Primary Active Session: Tab-scoped `sessionStorage` (`sitam_portal_token`, `sitam_portal_user`).
 *    This guarantees that Tab 1 (Guard) and Tab 2 (Admin) NEVER overwrite each other.
 * 2. Role-Scoped Persistence: `localStorage` (`sitam_session_${role}_token`, `sitam_session_${role}_user`).
 *    Allows new tabs opening a specific portal route to restore that role's session.
 */

const ACTIVE_TOKEN_KEY = 'sitam_portal_token';
const ACTIVE_USER_KEY  = 'sitam_portal_user';

function getRoleForPath(path = window.location.pathname) {
  if (path.startsWith('/security')) return 'SECURITY_GUARD';
  if (path.startsWith('/exit-passes')) return 'HOSTEL_WARDEN';
  return null;
}

function resolveSessionFromStorage() {
  // 1. Check tab-isolated sessionStorage
  try {
    const tabToken = sessionStorage.getItem(ACTIVE_TOKEN_KEY);
    const tabUser  = sessionStorage.getItem(ACTIVE_USER_KEY);
    if (tabToken && tabUser) {
      return { token: tabToken, user: JSON.parse(tabUser) };
    }
  } catch (_) {}

  // 2. Fallback to role-scoped localStorage based on route or last active role
  try {
    const targetRole = getRoleForPath();
    if (targetRole) {
      const roleToken = localStorage.getItem(`sitam_session_${targetRole}_token`);
      const roleUser  = localStorage.getItem(`sitam_session_${targetRole}_user`);
      if (roleToken && roleUser) {
        // Hydrate current tab sessionStorage from role-scoped localStorage
        sessionStorage.setItem(ACTIVE_TOKEN_KEY, roleToken);
        sessionStorage.setItem(ACTIVE_USER_KEY, roleUser);
        return { token: roleToken, user: JSON.parse(roleUser) };
      }
    }

    // 3. Fallback to legacy/general admin token if available
    const fallbackToken = localStorage.getItem('admin_token');
    const fallbackUser  = localStorage.getItem('admin_user');
    if (fallbackToken && fallbackUser) {
      sessionStorage.setItem(ACTIVE_TOKEN_KEY, fallbackToken);
      sessionStorage.setItem(ACTIVE_USER_KEY, fallbackUser);
      return { token: fallbackToken, user: JSON.parse(fallbackUser) };
    }
  } catch (_) {}

  return { token: null, user: null };
}

export const authStore = {
  getToken: () => {
    const session = resolveSessionFromStorage();
    return session.token;
  },

  getUser: () => {
    const session = resolveSessionFromStorage();
    return session.user;
  },

  setAuth: (token, user) => {
    if (!token || !user) return;
    const role = user.role || 'STAFF';

    // 1. Tab-isolated session storage (Primary)
    try {
      sessionStorage.setItem(ACTIVE_TOKEN_KEY, token);
      sessionStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user));
    } catch (_) {}

    // 2. Role-scoped persistent storage (Backup per role)
    try {
      localStorage.setItem(`sitam_session_${role}_token`, token);
      localStorage.setItem(`sitam_session_${role}_user`, JSON.stringify(user));

      // Synchronize legacy keys for single-tab backwards compatibility
      localStorage.setItem('admin_token', token);
      localStorage.setItem('admin_user', JSON.stringify(user));
    } catch (_) {}
  },

  clearAuth: () => {
    let currentRole = null;
    try {
      const userStr = sessionStorage.getItem(ACTIVE_USER_KEY);
      if (userStr) {
        const u = JSON.parse(userStr);
        currentRole = u?.role;
      }
    } catch (_) {}

    // 1. Clear current tab's sessionStorage
    try {
      sessionStorage.removeItem(ACTIVE_TOKEN_KEY);
      sessionStorage.removeItem(ACTIVE_USER_KEY);
    } catch (_) {}

    // 2. Clear role-scoped localStorage ONLY for this role (keeps other tab/role sessions alive!)
    if (currentRole) {
      try {
        localStorage.removeItem(`sitam_session_${currentRole}_token`);
        localStorage.removeItem(`sitam_session_${currentRole}_user`);
      } catch (_) {}
    }

    try {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
    } catch (_) {}
  },

  isAuthenticated: () => {
    const session = resolveSessionFromStorage();
    return !!session.token;
  }
};
