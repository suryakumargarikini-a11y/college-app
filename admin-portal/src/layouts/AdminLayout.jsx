import React, { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import CommandPalette from '../components/CommandPalette';
import { authStore } from '../store/authStore';

const COLLAPSED_KEY = 'sitam_sidebar_collapsed';

export default function AdminLayout() {
  if (!authStore.isAuthenticated()) return <Navigate to="/login" replace />;

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; }
    catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const handleCollapse = () => {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  // Global Ctrl+K listener
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const sidebarPx = collapsed ? 72 : 260;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-blue-500 selection:text-white">
      <Sidebar
        collapsed={collapsed}
        onCollapse={handleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <Topbar
        onMenuClick={() => setMobileOpen(true)}
        sidebarWidth={`${sidebarPx}px`}
        onCmdOpen={() => setCmdOpen(true)}
      />

      <main
        className={`transition-all duration-300 pt-16 min-h-screen ml-0 ${
          collapsed ? 'md:ml-[72px]' : 'md:ml-[260px]'
        }`}
      >
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
          <Outlet />
        </div>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
