import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { authStore } from '../store/authStore';

const TITLES = {
  '/dashboard':            'Executive Dashboard',
  '/students':             'Student Registry',
  '/faculty':              'Faculty Directory',
  '/attendance-dashboard': 'Attendance Analytics',
  '/marks-ledger':         'Academic Marks Ledger',
  '/fees-dashboard':       'Fee Collection Analytics',
  '/placements-dashboard': 'Placement Analytics',
  '/lms-dashboard':        'LMS Dashboard',
  '/analytics':            'Executive Analytics',
  '/risk-dashboard':       'Risk Dashboard',
  '/activity-center':      'Activity Center',
  '/announcements':        'Announcements',
  '/placements':           'Placement Drives',
  '/fee-notices':          'Fee Notices',
  '/exit-passes':          'Exit Pass Management',
  '/notifications':        'Notifications',
  '/settings':              'Settings',
  '/security/dashboard':   'Security Dashboard',
  '/security/verify-otp':  'Gate QR Verification',
  '/security/history':     'Verification History',
};

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-xs font-mono text-gray-400 tabular-nums hidden sm:block">{time}</span>;
}

export default function Topbar({ onMenuClick, sidebarWidth, onCmdOpen }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'Admin Portal';
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

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <header
      className={`fixed top-0 right-0 h-14 bg-white/90 backdrop-blur-sm border-b border-gray-200 flex items-center px-4 z-20 gap-3 left-0 ${
        sidebarWidth === '64px' ? 'md:left-16' : 'md:left-60'
      }`}
    >
      {/* Mobile hamburger */}
      <button className="btn-icon md:hidden flex-shrink-0" onClick={onMenuClick} aria-label="Open navigation menu">
        <span className="material-symbols-outlined text-[22px]">menu</span>
      </button>

      {/* Page title */}
      <h1 className="text-sm font-bold text-gray-900 truncate flex-1">{title}</h1>

      {/* Right cluster */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <LiveClock />
        <span className="text-xs text-gray-400 hidden lg:block">{today}</span>

        {/* Ctrl+K Command Palette trigger */}
        <button
          onClick={onCmdOpen}
          title="Command Palette (Ctrl+K)"
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors text-xs text-gray-500 no-print"
        >
          <span className="material-symbols-outlined text-[14px]">search</span>
          <span className="hidden md:inline">Search…</span>
          <kbd className="ml-1 px-1.5 py-0.5 text-[9px] font-mono bg-white rounded border border-gray-200">⌘K</kbd>
        </button>

        <div className="hidden sm:block w-px h-4 bg-gray-200" />

        {/* Avatar + dropdown */}
        <div className="relative" ref={avatarRef}>
          <button
            onClick={() => setAvatarOpen(v => !v)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-100 transition-colors"
            aria-label="Account menu"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm">
              {initials}
            </div>
            <span className="hidden sm:block text-xs font-medium text-gray-700 max-w-[100px] truncate">
              {user?.name || 'Admin'}
            </span>
            <span className="material-symbols-outlined text-[16px] text-gray-400 hidden sm:block">expand_more</span>
          </button>

          {avatarOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 z-50 fade-in">
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-900 truncate">{user?.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{user?.email}</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 uppercase">
                  {user?.role?.replace(/_/g,' ')}
                </span>
              </div>
              <a href="/settings" className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors">
                <span className="material-symbols-outlined text-[16px] text-gray-400">manage_accounts</span>
                Settings
              </a>
              <button
                onClick={() => { authStore.clearAuth(); window.location.href = '/login'; }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
