import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { authStore } from '../store/authStore';
import sitamLogo from '../sitam_logo.png';

const MENU_GROUPS = [
  {
    group: 'OVERVIEW',
    items: [
      { path: '/dashboard', icon: 'dashboard', label: 'Dashboard', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI'] },
      { path: '/security/dashboard', icon: 'security', label: 'Security Dashboard', roles: ['SECURITY_GUARD'] },
      { path: '/security/verify-otp', icon: 'qr_code_scanner', label: 'Gate Scan & Verification', roles: ['SECURITY_GUARD'] },
      { path: '/security/history', icon: 'history', label: 'Verification Logs', roles: ['SECURITY_GUARD'] },
      { path: '/activity-center', icon: 'timeline', label: 'Activity Center', roles: ['SUPER_ADMIN', 'DEAN', 'CI'] },
    ]
  },
  {
    group: 'ACADEMICS',
    items: [
      { path: '/students', icon: 'groups', label: 'Students', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI', 'HOSTEL_WARDEN'] },
      { path: '/faculty', icon: 'school', label: 'Faculty Directory', roles: ['SUPER_ADMIN', 'DEAN'] },
      { path: '/attendance-dashboard', icon: 'event_available', label: 'Attendance Analytics', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI'] },
      { path: '/marks-ledger', icon: 'grading', label: 'Marks Ledger', roles: ['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI'] },
      { path: '/lms-dashboard', icon: 'import_contacts', label: 'LMS Academic Workspace', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI'] },
      { path: '/e-library', icon: 'local_library', label: 'E-Library Resources', roles: ['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'FACULTY', 'HOD', 'DEAN', 'CI'] },
      { path: '/achievements', icon: 'emoji_events', label: 'Branch Achievements', roles: ['SUPER_ADMIN', 'HOD', 'DEAN', 'CI'] },
    ]
  },
  {
    group: 'FINANCE',
    items: [
      { path: '/fees-dashboard', icon: 'account_balance_wallet', label: 'Fees Analytics', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'DEAN', 'CI'] },
      { path: '/fee-notices', icon: 'receipt_long', label: 'Fee Notices', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI'] },
    ]
  },
  {
    group: 'CAMPUS',
    items: [
      { path: '/exit-passes', icon: 'exit_to_app', label: 'Exit Pass Requests', roles: ['SUPER_ADMIN', 'HOD', 'DEAN', 'CI', 'HOSTEL_WARDEN', 'FACULTY'] },
      { path: '/announcements', icon: 'campaign', label: 'Campus Announcements', roles: ['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI'] },
      { path: '/notifications', icon: 'notifications', label: 'In-App Notifications', roles: ['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'DEAN'] },
    ]
  },
  {
    group: 'ANALYTICS',
    items: [
      { path: '/placements-dashboard', icon: 'analytics', label: 'Placement Analytics', roles: ['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'DEAN'] },
      { path: '/placements', icon: 'work', label: 'Placement Drives', roles: ['SUPER_ADMIN', 'PLACEMENT_ADMIN'] },
      { path: '/analytics', icon: 'insights', label: 'Executive Analytics', roles: ['SUPER_ADMIN', 'CI'] },
      { path: '/risk-dashboard', icon: 'warning', label: 'Academic Risk Monitor', roles: ['SUPER_ADMIN'] },
    ]
  },
  {
    group: 'ADMINISTRATION',
    items: [
      { path: '/staff-management', icon: 'manage_accounts', label: 'Staff Scoping & RBAC', roles: ['SUPER_ADMIN'] },
      { path: '/settings', icon: 'settings', label: 'System Settings', roles: ['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI'] },
    ]
  }
];

const ROLE_LABELS = {
  SUPER_ADMIN:     'Super Admin',
  ACCOUNTS_ADMIN:  'Accounts Admin',
  PLACEMENT_ADMIN: 'Placement Officer',
  SECURITY_GUARD:  'Security Guard',
  FACULTY:         'Faculty',
  HOD:             'Head of Department',
  DEAN:            'Dean Academics',
  CI:              'College Admin Head',
  HOSTEL_WARDEN:   'Hostel Warden',
};

export default function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose }) {
  const navigate = useNavigate();
  const user = authStore.getUser();
  const role = user?.role || 'SUPER_ADMIN';

  const handleLogout = () => {
    authStore.clearAuth();
    navigate('/login');
  };

  const widthCls = collapsed ? 'w-[72px]' : 'w-[260px]';

  const filterItemsForRole = () => {
    return MENU_GROUPS.map(g => ({
      group: g.group,
      items: g.items.filter(item => item.roles.includes(role))
    })).filter(g => g.items.length > 0);
  };

  const visibleGroups = filterItemsForRole();

  const SidebarContent = ({ compact }) => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200/80">
      {/* Official SITAM Brand Header */}
      <div className={`flex items-center gap-3 border-b border-slate-100 flex-shrink-0 ${compact ? 'px-2 py-4 justify-center' : 'px-5 py-4'}`}>
        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/80 p-1 flex items-center justify-center shadow-sm flex-shrink-0 overflow-hidden">
          <img src={sitamLogo} alt="SITAM Logo" className="w-full h-full object-contain" />
        </div>
        {!compact && (
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-slate-900 leading-tight tracking-tight flex items-center gap-1.5">
              <span>SITAM ERP</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            </h1>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">Admin Portal</p>
          </div>
        )}
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto custom-scrollbar">
        {visibleGroups.map((g, gIdx) => (
          <div key={gIdx} className="space-y-1">
            {!compact && (
              <p className="px-3 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">
                {g.group}
              </p>
            )}
            {g.items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onMobileClose}
                title={compact ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 relative group ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  } ${compact ? 'justify-center px-0' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`material-symbols-outlined text-[20px] flex-shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-500'}`}>
                      {item.icon}
                    </span>
                    {!compact && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User Badge & Logout Footer */}
      <div className={`border-t border-slate-100 flex-shrink-0 bg-slate-50/50 ${compact ? 'p-2' : 'p-3'}`}>
        {!compact && (
          <div className="p-3 mb-2 bg-white rounded-xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                {user?.name ? user.name.charAt(0).toUpperCase() : 'A'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate leading-tight">{user?.name || 'Administrator'}</p>
                <p className="text-[10px] text-slate-500 truncate mt-0.5">{user?.email}</p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px]">
              <span className="px-2 py-0.5 rounded-md font-extrabold bg-blue-50 text-blue-700 border border-blue-200/60 uppercase tracking-wider">
                {ROLE_LABELS[role] || role}
              </span>
              <span className="font-mono text-slate-400">ONLINE</span>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          title="Sign Out"
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-all ${compact ? 'justify-center px-0' : ''}`}
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          {!compact && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex fixed left-0 top-0 h-screen flex-col z-30 sidebar-transition overflow-hidden shadow-sm ${widthCls}`}
      >
        <button
          onClick={onCollapse}
          className="absolute top-4 right-3 z-20 w-7 h-7 rounded-lg bg-white border border-slate-200/80 flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-50 shadow-xs transition-all"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="material-symbols-outlined text-[18px]">
            {collapsed ? 'chevron_right' : 'chevron_left'}
          </span>
        </button>

        <SidebarContent compact={collapsed} />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 md:hidden"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="fixed left-0 top-0 h-screen w-72 bg-white z-50 md:hidden flex flex-col shadow-2xl">
            <SidebarContent compact={false} />
          </aside>
        </>
      )}
    </>
  );
}
