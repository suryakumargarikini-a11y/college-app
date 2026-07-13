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

  const sidebarPx = collapsed ? 64 : 240;

  return (
    <div className="min-h-screen bg-[#f8fafc]">
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
        className="transition-all duration-300 pt-14 min-h-screen"
        style={{ marginLeft: `${sidebarPx}px` }}
      >
        <div className="md:hidden" style={{ marginLeft: 0 }} />
        <div className="p-5 sm:p-6 max-w-screen-2xl">
          <Outlet />
        </div>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
