import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { authStore } from '../store/authStore';

export default function Sidebar() {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const role = user?.role || 'SUPER_ADMIN';

  let items = [];
  if (role === 'SECURITY_GUARD') {
    items = [
      { path: '/security/dashboard', icon: 'security', label: 'Dashboard' },
      { path: '/security/verify-otp', icon: 'pin', label: 'OTP Verification' },
      { path: '/security/history', icon: 'history', label: 'Verification History' },
    ];
  } else if (role === 'ACCOUNTS_ADMIN') {
    items = [
      { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
      { path: '/fee-notices', icon: 'receipt_long', label: 'Fee Notices' },
      { path: '/settings', icon: 'settings', label: 'Settings' },
    ];
  } else if (role === 'PLACEMENT_ADMIN') {
    items = [
      { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
      { path: '/announcements', icon: 'campaign', label: 'Announcements' },
      { path: '/placements', icon: 'work', label: 'Placement Drives' },
      { path: '/notifications', icon: 'notifications', label: 'Notifications' },
      { path: '/settings', icon: 'settings', label: 'Settings' },
    ];
  } else {
    // SUPER_ADMIN
    items = [
      { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
      { path: '/announcements', icon: 'campaign', label: 'Announcements' },
      { path: '/placements', icon: 'work', label: 'Placement Drives' },
      { path: '/fee-notices', icon: 'receipt_long', label: 'Fee Notices' },
      { path: '/exit-passes', icon: 'exit_to_app', label: 'Exit Passes' },
      { path: '/notifications', icon: 'notifications', label: 'Notifications' },
      { path: '/settings', icon: 'settings', label: 'Settings' },
    ];
  }

  const handleLogout = () => {
    authStore.clearAuth();
    navigate('/login');
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-white border-r border-gray-200 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontSize: '18px' }}>school</span>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">SITAM ERP</p>
            <p className="text-xs text-gray-500">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'}`
            }
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-gray-200">
        <div className="px-3 py-2 mb-2">
          <p className="text-xs font-semibold text-gray-900 truncate">{user?.name || 'Admin'}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700">
            {user?.role || 'SUPER_ADMIN'}
          </span>
        </div>
        <button onClick={handleLogout} className="sidebar-link sidebar-link-inactive w-full">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>logout</span>
          Logout
        </button>
      </div>
    </aside>
  );
}
