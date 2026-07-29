import React, { useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { authStore } from '../store/authStore';

const TITLES = {
  '/dashboard':            'Executive Dashboard',
  '/students':             'Student Registry',
  '/faculty':              'Faculty Directory',
  '/attendance-dashboard': 'Attendance Analytics',
  '/marks-ledger':         'Academic Marks Ledger',
  '/fees-dashboard':       'Fee Collection Analytics',
  '/placements-dashboard': 'Placement Analytics',
  '/lms-dashboard':        'LMS Academic Workspace',
  '/e-library':            'E-Library Resources',
  '/achievements':         'Branch Achievements',
  '/analytics':            'Executive Analytics',
  '/risk-dashboard':       'Academic Risk Monitor',
  '/activity-center':      'Activity Center Audit Logs',
  '/announcements':        'Campus Announcements',
  '/placements':           'Placement Drives',
  '/fee-notices':          'Fee Demand Notices',
  '/exit-passes':          'Exit Pass Management',
  '/notifications':        'In-App Notifications',
  '/staff-management':      'Staff Scoping & RBAC',
  '/settings':              'System Settings',
  '/security/dashboard':   'Security Guard Dashboard',
  '/security/verify-otp':  'Gate Scan & Verification',
  '/security/history':     'Verification History',
};

const CATEGORIES = {
  '/dashboard':            'Overview',
  '/students':             'Academics',
  '/faculty':              'Academics',
  '/attendance-dashboard': 'Academics',
  '/marks-ledger':         'Academics',
  '/lms-dashboard':        'Academics',
  '/e-library':            'Academics',
  '/achievements':         'Academics',
  '/fees-dashboard':       'Finance',
  '/fee-notices':          'Finance',
  '/exit-passes':          'Campus Services',
  '/announcements':        'Campus Services',
  '/notifications':        'Campus Services',
  '/placements-dashboard': 'Analytics',
  '/placements':           'Analytics',
  '/analytics':            'Analytics',
  '/risk-dashboard':       'Analytics',
  '/activity-center':      'Overview',
  '/staff-management':      'Administration',
  '/settings':              'Administration',
};

function LiveStatusBadge() {
  const [time, setTime] = useState('');
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-GB', { hour12: false }));
      const dateOptions = { day: '2-digit', month: 'short', year: 'numeric' };
      setDateStr(now.toLocaleDateString('en-GB', dateOptions).toUpperCase());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden lg:flex items-center gap-3 border-r border-slate-200/80 pr-4">
      <div className="flex flex-col items-end text-right">
        <span className="text-[11px] font-bold text-slate-700 font-mono tracking-tight">{dateStr}</span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{time} • ONLINE</span>
        </div>
      </div>
    </div>
  );
}

export default function Topbar({ onMenuClick, sidebarWidth, onCmdOpen }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'Admin Portal';
  const category = CATEGORIES[pathname] || 'SITAM ERP';
  const user = authStore.getUser();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target)) setAvatarOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initials = (user?.name || 'A')
    .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const isCollapsed = sidebarWidth === '72px';

  return (
    <header
      className={`fixed top-0 right-0 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center px-4 sm:px-6 z-20 gap-4 left-0 transition-all duration-300 ${
        isCollapsed ? 'md:left-[72px]' : 'md:left-[260px]'
      }`}
    >
      {/* Mobile Hamburger */}
      <button
        className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
        onClick={onMenuClick}
        aria-label="Open navigation drawer"
      >
        <span className="material-symbols-outlined text-[20px]">menu</span>
      </button>

      {/* Page Title & Breadcrumb */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
          <span>SITAM ERP</span>
          <span>/</span>
          <span className="text-blue-600 font-bold">{category}</span>
        </div>
        <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight truncate leading-tight mt-0.5">
          {title}
        </h1>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Search Command Palette Button */}
        <button
          onClick={onCmdOpen}
          title="Global Search & Navigation (Ctrl+K)"
          className="hidden sm:flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl border border-slate-200/80 bg-slate-50 hover:bg-white hover:border-blue-500/40 hover:shadow-xs transition-all text-xs text-slate-500 no-print group"
        >
          <span className="material-symbols-outlined text-[16px] text-slate-400 group-hover:text-blue-600 transition-colors">search</span>
          <span className="font-medium text-slate-600">Search portal...</span>
          <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white text-slate-500 rounded-md border border-slate-200 shadow-xs">⌘K</kbd>
        </button>

        {/* Live System Status Clock */}
        <LiveStatusBadge />

        {/* Admin Profile Dropdown */}
        <div className="relative" ref={avatarRef}>
          <button
            onClick={() => setAvatarOpen(v => !v)}
            className="flex items-center gap-2.5 rounded-xl p-1 sm:px-2 sm:py-1 hover:bg-slate-100/80 border border-transparent hover:border-slate-200/60 transition-all"
            aria-label="Account menu"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0 shadow-sm">
              {initials}
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-bold text-slate-900 leading-tight max-w-[120px] truncate">
                {user?.name || 'Administrator'}
              </span>
              <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">
                {user?.role?.replace(/_/g, ' ')}
              </span>
            </div>
            <span className="material-symbols-outlined text-[18px] text-slate-400 hidden sm:block">expand_more</span>
          </button>

          {avatarOpen && (
            <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-2xl border border-slate-200 shadow-xl py-2 z-50 fade-in">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <p className="text-xs font-bold text-slate-900 truncate">{user?.name}</p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{user?.email}</p>
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60 uppercase tracking-wider">
                  <span className="w-1 h-1 rounded-full bg-blue-600"></span>
                  <span>{user?.role?.replace(/_/g, ' ')}</span>
                </div>
              </div>
              <Link
                to="/settings"
                onClick={() => setAvatarOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px] text-slate-400">settings</span>
                <span>System Settings</span>
              </Link>
              <button
                onClick={() => { authStore.clearAuth(); window.location.href = '/login'; }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
