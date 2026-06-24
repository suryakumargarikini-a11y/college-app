export const authStore = {
  getToken: () => localStorage.getItem('admin_token'),
  getUser: () => {
    try {
      return JSON.parse(localStorage.getItem('admin_user'));
    } catch {
      return null;
    }
  },
  setAuth: (token, user) => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(user));
  },
  clearAuth: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  },
  isAuthenticated: () => !!localStorage.getItem('admin_token'),
};
