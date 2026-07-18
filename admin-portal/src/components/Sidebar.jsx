import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { authStore } from '../store/authStore';

const NAV_BY_ROLE = {
  SECURITY_GUARD: [
    { path: '/security/dashboard', icon: 'security',    label: 'Dashboard' },
    { path: '/security/verify-otp', icon: 'pin',        label: 'OTP Verification' },
    { path: '/security/history',    icon: 'history',    label: 'Verification History' },
  ],
  ACCOUNTS_ADMIN: [
    { path: '/dashboard',           icon: 'dashboard',              label: 'Dashboard' },
    { path: '/students',            icon: 'groups',                 label: 'Students' },
    { path: '/attendance-dashboard', icon: 'event_available',       label: 'Attendance Analytics' },
    { path: '/fees-dashboard',      icon: 'account_balance_wallet', label: 'Fees Analytics' },
    { path: '/fee-notices',         icon: 'receipt_long',           label: 'Fee Notices' },
    { path: '/lms-dashboard',       icon: 'import_contacts',        label: 'LMS Progress' },
    { path: '/settings',            icon: 'settings',               label: 'Settings' },
  ],
  PLACEMENT_ADMIN: [
    { path: '/dashboard',            icon: 'dashboard',       label: 'Dashboard' },
    { path: '/students',             icon: 'groups',          label: 'Students' },
    { path: '/attendance-dashboard',  icon: 'event_available', label: 'Attendance Analytics' },
    { path: '/marks-ledger',         icon: 'grading',         label: 'Marks Ledger' },
    { path: '/placements-dashboard', icon: 'analytics',       label: 'Placements Analytics' },
    { path: '/placements',           icon: 'work',            label: 'Placement Drives' },
    { path: '/announcements',        icon: 'campaign',        label: 'Announcements' },
    { path: '/notifications',        icon: 'notifications',   label: 'Notifications' },
    { path: '/e-library',            icon: 'local_library',   label: 'E-Library' },
    { path: '/lms-dashboard',        icon: 'import_contacts', label: 'LMS Progress' },
    { path: '/settings',             icon: 'settings',        label: 'Settings' },
  ],
  FACULTY: [
    { path: '/exit-passes',          icon: 'exit_to_app',     label: 'Exit Passes' },
    { path: '/e-library',            icon: 'local_library',   label: 'E-Library' },
  ],
};

const SUPER_ADMIN_NAV = [
  { path: '/dashboard',             icon: 'dashboard',              label: 'Dashboard' },
  { path: '/students',              icon: 'groups',                 label: 'Students' },
  { path: '/faculty',               icon: 'school',                 label: 'Faculty' },
  { path: '/attendance-dashboard',  icon: 'event_available',        label: 'Attendance Analytics' },
  { path: '/marks-ledger',          icon: 'grading',                label: 'Marks Ledger' },
  { path: '/fees-dashboard',        icon: 'account_balance_wallet', label: 'Fees Analytics' },
  { path: '/placements-dashboard',  icon: 'analytics',              label: 'Placements Analytics' },
  { path: '/lms-dashboard',         icon: 'import_contacts',        label: 'LMS Progress' },
  { path: '/analytics',             icon: 'insights',               label: 'Executive Analytics' },
  { path: '/risk-dashboard',        icon: 'warning',                label: 'Risk Dashboard' },
  { path: '/activity-center',       icon: 'timeline',               label: 'Activity Center' },
  { path: '/placements',            icon: 'work',                   label: 'Placement Drives' },
  { path: '/announcements',         icon: 'campaign',               label: 'Announcements' },
  { path: '/fee-notices',           icon: 'receipt_long',           label: 'Fee Notices' },
  { path: '/exit-passes',           icon: 'exit_to_app',            label: 'Exit Passes' },
  { path: '/notifications',         icon: 'notifications',          label: 'Notifications' },
  { path: '/e-library',             icon: 'local_library',          label: 'E-Library' },
  { path: '/settings',              icon: 'settings',               label: 'Settings' },
];

const ROLE_LABELS = {
  SUPER_ADMIN:     'Super Admin',
  ACCOUNTS_ADMIN:  'Accounts Admin',
  PLACEMENT_ADMIN: 'Placement Officer',
  SECURITY_GUARD:  'Security Guard',
  FACULTY:         'Faculty',
};

export default function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose }) {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const role = user?.role || 'SUPER_ADMIN';
  const items = NAV_BY_ROLE[role] ?? SUPER_ADMIN_NAV;

  const handleLogout = () => {
    authStore.clearAuth();
    navigate('/login');
  };

  /* width class based on collapsed state */
  const widthCls = collapsed ? 'w-16' : 'w-60';

  /* ── Inner sidebar content (shared between desktop & mobile) ── */
  const SidebarContent = ({ compact }) => (
    <div className="flex flex-col h-full">
      {/* Logo row */}
      <div className={`flex items-center gap-2.5 border-b border-gray-100 flex-shrink-0 ${compact ? 'px-3 py-4 justify-center' : 'px-4 py-4'}`}>
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-white text-[18px]">school</span>
        </div>
        {!compact && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-none">SITAM ERP</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Admin Portal</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {items.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onMobileClose}
            title={compact ? item.label : undefined}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'} ${compact ? 'justify-center px-2' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                {/* Active accent bar */}
                {isActive && !compact && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-blue-600 rounded-r-full" />
                )}
                <span className={`material-symbols-outlined text-[20px] flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>
                  {item.icon}
                </span>
                {!compact && <span className="truncate">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User + Logout */}
      <div className={`border-t border-gray-100 flex-shrink-0 ${compact ? 'px-2 py-3' : 'px-3 py-3'}`}>
        {!compact && (
          <div className="px-2 py-2 mb-1">
            <p className="text-xs font-semibold text-gray-800 truncate">{user?.name || 'Admin'}</p>
            <p className="text-[11px] text-gray-400 truncate mt-0.5">{user?.email}</p>
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wide">
              {ROLE_LABELS[role] || role}
            </span>
          </div>
        )}
        <button
          onClick={handleLogout}
          title="Logout"
          className={`sidebar-link sidebar-link-inactive w-full text-red-500 hover:bg-red-50 hover:text-red-600 ${compact ? 'justify-center px-2' : ''}`}
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          {!compact && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside
        className={`
          hidden md:flex fixed left-0 top-0 h-screen flex-col
          bg-white border-r border-gray-200 z-30
          sidebar-transition overflow-hidden
          ${widthCls}
        `}
      >
        {/* Collapse toggle */}
        <button
          onClick={onCollapse}
          className="absolute top-3.5 right-2 z-10 btn-icon opacity-0 group-hover:opacity-100 hover:opacity-100"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ opacity: 0.6 }}
        >
          <span className="material-symbols-outlined text-[18px]">
            {collapsed ? 'chevron_right' : 'chevron_left'}
          </span>
        </button>

        <SidebarContent compact={collapsed} />
      </aside>

      {/* ── Mobile Drawer ── */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 md:hidden"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 z-50 md:hidden flex flex-col shadow-xl">
            <SidebarContent compact={false} />
          </aside>
        </>
      )}
    </>
  );
}
