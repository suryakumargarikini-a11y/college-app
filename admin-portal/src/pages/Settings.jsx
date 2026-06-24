import React, { useState } from 'react';
import api from '../lib/api';
import { authStore } from '../store/authStore';

export default function Settings() {
  const user = authStore.getUser();

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (pwForm.newPassword.length < 6) {
      setPwError('New password must be at least 6 characters');
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }

    setPwSaving(true);
    try {
      await api.put('/admin/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwSuccess('Password changed successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  const f = (key) => (e) => setPwForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Profile Card */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-600" style={{ fontSize: '20px' }}>manage_accounts</span>
          Profile Information
        </h2>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xl font-bold">
              {(user?.name || 'A')[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-gray-900">{user?.name || 'Admin User'}</p>
            <p className="text-sm text-gray-500">{user?.email || '—'}</p>
            <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700">
              {user?.role || 'SUPER_ADMIN'}
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Full Name</p>
            <p className="text-sm font-medium text-gray-900">{user?.name || '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Email Address</p>
            <p className="text-sm font-medium text-gray-900">{user?.email || '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Role</p>
            <p className="text-sm font-medium text-gray-900">{user?.role || 'SUPER_ADMIN'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Admin ID</p>
            <p className="text-sm font-medium text-gray-900 font-mono">{user?.id || '—'}</p>
          </div>
        </div>
      </div>

      {/* Change Password Card */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-600" style={{ fontSize: '20px' }}>lock</span>
          Change Password
        </h2>

        {pwError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>error</span>
              {pwError}
            </div>
          </div>
        )}

        {pwSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
              {pwSuccess}
            </div>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password *</label>
            <input
              type="password"
              className="input-field"
              placeholder="Enter your current password"
              value={pwForm.currentPassword}
              onChange={f('currentPassword')}
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password *</label>
            <input
              type="password"
              className="input-field"
              placeholder="At least 6 characters"
              value={pwForm.newPassword}
              onChange={f('newPassword')}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password *</label>
            <input
              type="password"
              className="input-field"
              placeholder="Re-enter new password"
              value={pwForm.confirmPassword}
              onChange={f('confirmPassword')}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end pt-2">
            <button type="submit" className="btn-primary flex items-center gap-2" disabled={pwSaving}>
              {pwSaving ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>lock_reset</span>
              )}
              {pwSaving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>

      {/* App Info */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-600" style={{ fontSize: '18px' }}>info</span>
          Application Info
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Application</p>
            <p className="text-sm font-medium text-gray-900">SITAM Smart ERP</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Portal Version</p>
            <p className="text-sm font-medium text-gray-900">v1.0.0</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">API Endpoint</p>
            <p className="text-sm font-medium text-gray-900 font-mono text-xs">
              {import.meta.env.VITE_API_BASE_URL || '/api'}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Environment</p>
            <p className="text-sm font-medium text-gray-900">{import.meta.env.MODE || 'development'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
