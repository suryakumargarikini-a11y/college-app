import React from 'react';
import { useLocation } from 'react-router-dom';

const titles = {
  '/dashboard': 'Dashboard',
  '/announcements': 'Announcements',
  '/placements': 'Placement Drives',
  '/fee-notices': 'Fee Notices',
  '/exit-passes': 'Exit Pass Management',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
  '/security/dashboard': 'Security Dashboard',
  '/security/verify-otp': 'OTP Verification',
  '/security/history': 'Verification History',
};

export default function Topbar() {
  const { pathname } = useLocation();
  const title = titles[pathname] || 'Admin Portal';

  return (
    <header className="fixed top-0 left-60 right-0 h-14 bg-white border-b border-gray-200 flex items-center px-6 z-20">
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-gray-500">SITAM Smart ERP v1.0</span>
      </div>
    </header>
  );
}
