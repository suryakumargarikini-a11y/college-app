import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { authStore } from '../store/authStore';
import PageHeader from '../components/PageHeader';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  ACCOUNTS_ADMIN: 'Accounts Administrator',
  PLACEMENT_ADMIN: 'Placement Officer',
  SECURITY_GUARD: 'Security Guard',
};

function InfoCell({ label, value, mono }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-sm font-semibold text-gray-900 ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function SectionTitle({ icon, label }) {
  return (
    <div className="flex items-center gap-2 mb-5 pb-3 border-b border-gray-100">
      <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
        <span className="material-symbols-outlined text-blue-600 text-[18px]">{icon}</span>
      </div>
      <h3 className="text-sm font-bold text-gray-900">{label}</h3>
    </div>
  );
}

export default function Settings() {
  const { toasts, showToast, removeToast } = useToast();
  const user = authStore.getUser();

  /* Change Password */
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');

  /* Maintenance Mode */
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceLoad, setMaintenanceLoad] = useState(true);
  const [maintenanceSave, setMaintenanceSave] = useState(false);

  useEffect(() => {
    api.get('/admin/settings/maintenance')
      .then(res => setMaintenance(res.data.maintenanceMode ?? false))
      .catch(() => { })
      .finally(() => setMaintenanceLoad(false));
  }, []);

  const handleChangePassword = async (e) => {
    e.preventDefault(); setPwError('');
    if (pwForm.newPassword.length < 6) { setPwError('New password must be at least 6 characters'); return; }
    if (pwForm.newPassword !== pwForm.confirmPassword) { setPwError('New passwords do not match'); return; }
    setPwSaving(true);
    try {
      await api.put('/admin/auth/change-password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      showToast('Password changed successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) { setPwError(err.response?.data?.error || 'Failed to change password'); }
    finally { setPwSaving(false); }
  };

  const toggleMaintenance = async () => {
    setMaintenanceSave(true);
    const next = !maintenance;
    try {
      await api.post('/admin/settings/maintenance', { maintenanceMode: next });
      setMaintenance(next);
      showToast(`Maintenance mode ${next ? 'enabled' : 'disabled'}`);
    } catch (err) { showToast(err.response?.data?.error || 'Failed to update maintenance mode', 'error'); }
    finally { setMaintenanceSave(false); }
  };

  const fpw = (key) => (e) => setPwForm(p => ({ ...p, [key]: e.target.value }));
  const initials = (user?.name || 'A').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6 max-w-2xl fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader title="Settings" subtitle="Manage your account and system configuration" />

      {/* ── Profile Card ── */}
      <div className="card p-6">
        <SectionTitle icon="manage_accounts" label="Profile Information" />
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center flex-shrink-0 shadow-md">
            <span className="text-white text-xl font-bold">{initials}</span>
          </div>
          <div>
            <p className="text-base font-bold text-gray-900">{user?.name || 'Admin User'}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wide">
              {ROLE_LABEL[user?.role] || user?.role || 'SUPER_ADMIN'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InfoCell label="Full Name" value={user?.name} />
          <InfoCell label="Email" value={user?.email} />
          <InfoCell label="Role" value={ROLE_LABEL[user?.role] || user?.role} />
          <InfoCell label="Admin ID" value={user?.id} mono />
        </div>
      </div>

      {/* ── Change Password Card ── */}
      <div className="card p-6">
        <SectionTitle icon="lock" label="Change Password" />
        {pwError && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <span className="material-symbols-outlined text-[16px]">error</span>
            {pwError}
          </div>
        )}
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Current Password *</label>
            <input type="password" className="input-field" placeholder="Enter your current password" value={pwForm.currentPassword} onChange={fpw('currentPassword')} required autoComplete="current-password" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">New Password *</label>
            <input type="password" className="input-field" placeholder="At least 6 characters" value={pwForm.newPassword} onChange={fpw('newPassword')} required minLength={6} autoComplete="new-password" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm New Password *</label>
            <input type="password" className="input-field" placeholder="Re-enter new password" value={pwForm.confirmPassword} onChange={fpw('confirmPassword')} required autoComplete="new-password" />
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" className="btn-primary" disabled={pwSaving}>
              {pwSaving ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">lock_reset</span>}
              {pwSaving ? 'Changing…' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Maintenance Mode Card ── */}
      <div className="card p-6">
        <SectionTitle icon="construction" label="System Maintenance" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900 mb-0.5">Maintenance Mode</p>
            <p className="text-xs text-gray-500 leading-relaxed max-w-sm">
              When enabled, students see a maintenance notice in the mobile app. Admin portal remains fully accessible.
            </p>
          </div>
          {maintenanceLoad ? (
            <div className="skeleton w-12 h-6 rounded-full" />
          ) : (
            <button
              onClick={toggleMaintenance}
              disabled={maintenanceSave}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${maintenance ? 'bg-amber-500' : 'bg-gray-200'}`}
              role="switch"
              aria-checked={maintenance}
              aria-label="Toggle maintenance mode"
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${maintenance ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          )}
        </div>
        {maintenance && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-medium text-amber-800">
            <span className="material-symbols-outlined text-[16px] text-amber-600">warning</span>
            Maintenance mode is currently <strong>ACTIVE</strong>. Students will see a maintenance screen.
          </div>
        )}
      </div>

      {/* ── App Info Card ── */}
      <div className="card p-6">
        <SectionTitle icon="info" label="Application Info" />
        <div className="grid grid-cols-2 gap-3">
          <InfoCell label="Application" value="SITAM Smart ERP" />
          <InfoCell label="Portal Version" value="v1.0.0" />
          <InfoCell label="API Endpoint" value={import.meta.env.VITE_API_BASE_URL || '(Not configured — set VITE_API_BASE_URL)'} mono />
          <InfoCell label="Environment" value={import.meta.env.MODE || 'development'} />
        </div>
      </div>
    </div>
  );
}
