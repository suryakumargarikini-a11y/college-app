import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const ROLES_LIST = [
  { value: 'HOD', label: 'Head of Department' },
  { value: 'DEAN', label: 'Dean Academics' },
  { value: 'CI', label: 'College Admin Head' },
  { value: 'HOSTEL_WARDEN', label: 'Hostel Warden' },
  { value: 'FACULTY', label: 'Faculty' },
];

const CANONICAL_DEPARTMENTS = [
  'AIML', 'AIDS', 'ECE', 'IT', 'MECH', 'CIVIL', 'EEE', 'MBA', 'POLYTECHNIC'
];

export default function StaffManagement() {
  const { toasts, showToast, removeToast } = useToast();
  
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [updating, setUpdating] = useState(false);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [resetting, setResetting] = useState(false);

  // Form Fields
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'HOD',
    initialPassword: '',
    departmentScopes: ['AIML']
  });

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/staff');
      setStaff(res.data.staff || []);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load staff list', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  // Submit Handler for Creating Account
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.initialPassword) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    if (formData.initialPassword.length < 8) {
      showToast('Password must be at least 8 characters long', 'error');
      return;
    }
    if (formData.role === 'HOD' && (!formData.departmentScopes || formData.departmentScopes.length === 0)) {
      showToast('At least one department scope is required for HOD', 'error');
      return;
    }

    const payload = {
      ...formData,
      departmentScopes: formData.role === 'HOD' ? formData.departmentScopes : []
    };

    setCreating(true);
    try {
      await api.post('/admin/staff', payload);
      showToast('Staff account created successfully', 'success');
      setShowCreateModal(false);
      setFormData({
        name: '',
        email: '',
        role: 'HOD',
        initialPassword: '',
        departmentScopes: ['AIML']
      });
      loadStaff();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to create staff account', 'error');
    } finally {
      setCreating(false);
    }
  };

  // Submit Handler for Updating Account
  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editTarget) return;

    const payload = {
      name: editTarget.name,
      email: editTarget.email,
      role: editTarget.role,
      isActive: editTarget.isActive,
      departmentScopes: editTarget.role === 'HOD' ? editTarget.departmentScopes : []
    };

    setUpdating(true);
    try {
      await api.put(`/admin/staff/${editTarget.id}`, payload);
      showToast('Staff account updated successfully', 'success');
      setEditTarget(null);
      loadStaff();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update staff account', 'error');
    } finally {
      setUpdating(false);
    }
  };

  // Submit Handler for Password Reset
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetTarget || !resetPasswordVal) return;
    if (resetPasswordVal.length < 8) {
      showToast('Password must be at least 8 characters long', 'error');
      return;
    }

    setResetting(true);
    try {
      await api.post(`/admin/staff/${resetTarget.id}/reset-password`, { newPassword: resetPasswordVal });
      showToast(`Password for ${resetTarget.email} reset successfully`, 'success');
      setResetTarget(null);
      setResetPasswordVal('');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reset password', 'error');
    } finally {
      setResetting(false);
    }
  };

  // Toggle Active Status
  const handleToggleStatus = async (user) => {
    try {
      await api.delete(`/admin/staff/${user.id}`);
      showToast(`Account ${user.email} status updated to ${user.isActive ? 'Inactive' : 'Active'}`, 'info');
      loadStaff();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to toggle status', 'error');
    }
  };

  // Department checkbox toggle helper
  const toggleDeptScope = (dept, isEdit = false) => {
    if (isEdit) {
      setEditTarget(prev => {
        const cur = prev.departmentScopes || [];
        const next = cur.includes(dept) ? cur.filter(d => d !== dept) : [...cur, dept];
        return { ...prev, departmentScopes: next };
      });
    } else {
      setFormData(prev => {
        const cur = prev.departmentScopes || [];
        const next = cur.includes(dept) ? cur.filter(d => d !== dept) : [...cur, dept];
        return { ...prev, departmentScopes: next };
      });
    }
  };

  // Filtered List
  const filteredStaff = staff.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
                          item.email.toLowerCase().includes(search.toLowerCase()) ||
                          item.role.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || item.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const totalHod = staff.filter(s => s.role === 'HOD').length;
  const totalDeans = staff.filter(s => s.role === 'DEAN' || s.role === 'CI').length;
  const totalWarden = staff.filter(s => s.role === 'HOSTEL_WARDEN').length;

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <PageHeader
        title="Special Staff & Admin Account Management"
        subtitle="Provision, configure, and manage staff accounts and department scopes"
        actions={
          <button onClick={() => setShowCreateModal(true)} className="btn-primary h-9 gap-2">
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            Add Staff Account
          </button>
        }
      />

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-[20px]">manage_accounts</span>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Accounts</p>
            <p className="text-xl font-extrabold text-gray-900">{staff.length}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-[20px]">school</span>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">HOD Accounts</p>
            <p className="text-xl font-extrabold text-gray-900">{totalHod}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-[20px]">workspace_premium</span>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Deans & CI</p>
            <p className="text-xl font-extrabold text-gray-900">{totalDeans}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-[20px]">home</span>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Hostel Warden</p>
            <p className="text-xl font-extrabold text-gray-900">{totalWarden}</p>
          </div>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search staff name, email, or role…" />
        
        <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
          {['ALL', 'HOD', 'DEAN', 'CI', 'HOSTEL_WARDEN', 'FACULTY', 'SUPER_ADMIN'].map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                roleFilter === role ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {role === 'ALL' ? 'All Roles' : role}
            </button>
          ))}
        </div>
      </div>

      {/* Staff Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading staff accounts…</div>
        ) : filteredStaff.length === 0 ? (
          <EmptyState icon="person_off" title="No staff accounts found" description="Try adjusting your filter or search query." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="th">Staff Details</th>
                  <th className="th">Role</th>
                  <th className="th">Department Scopes</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map(member => {
                  const scopes = member.staffScopes ? member.staffScopes.map(s => s.scopeValue) : [];
                  return (
                    <tr key={member.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="td space-y-0.5">
                        <p className="text-sm font-bold text-gray-900">{member.name}</p>
                        <p className="text-xs font-mono text-gray-500">{member.email}</p>
                      </td>
                      <td className="td">
                        <span className="inline-block px-2.5 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700">
                          {member.role}
                        </span>
                      </td>
                      <td className="td">
                        {scopes.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {scopes.map(sc => (
                              <span key={sc} className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-100">
                                {sc} {sc === 'AIML' ? '(+CSE)' : ''}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic">
                            {member.role === 'DEAN' || member.role === 'CI' ? 'Global Scope' : 'No Scope Assigned'}
                          </span>
                        )}
                      </td>
                      <td className="td">
                        <Badge value={member.isActive ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="td">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditTarget({ ...member, departmentScopes: scopes })}
                            className="btn-secondary h-8 text-xs"
                            title="Edit Account Details & Scopes"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setResetTarget(member)}
                            className="btn-secondary h-8 text-xs text-amber-600 hover:bg-amber-50"
                            title="Reset Password"
                          >
                            Reset Pwd
                          </button>
                          <button
                            onClick={() => handleToggleStatus(member)}
                            className={`btn-secondary h-8 text-xs ${
                              member.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {member.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE STAFF MODAL */}
      <Modal
        isOpen={showCreateModal}
        title="Add Special Staff Account"
        onClose={() => setShowCreateModal(false)}
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Full Name *</label>
            <input
              type="text"
              required
              className="input-field"
              placeholder="e.g. Dr. K. Rama Rao"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Institutional Email *</label>
            <input
              type="email"
              required
              className="input-field"
              placeholder="e.g. hod.aiml@sitam.edu.in"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Staff Role *</label>
              <select
                className="input-field"
                value={formData.role}
                onChange={e => setFormData({ ...formData, role: e.target.value })}
              >
                {ROLES_LIST.map(r => (
                  <option key={r.value} value={r.value}>{r.label} ({r.value})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Initial Password *</label>
              <input
                type="password"
                required
                minLength={8}
                className="input-field"
                placeholder="At least 8 chars"
                value={formData.initialPassword}
                onChange={e => setFormData({ ...formData, initialPassword: e.target.value })}
              />
            </div>
          </div>

          {formData.role === 'HOD' && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-2">
              <label className="label">Department Scope Assignment *</label>
              <p className="text-xs text-gray-500">Select department(s) governed by this HOD account:</p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {CANONICAL_DEPARTMENTS.map(dept => (
                  <label key={dept} className="flex items-center gap-2 text-xs font-semibold text-gray-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(formData.departmentScopes || []).includes(dept)}
                      onChange={() => toggleDeptScope(dept, false)}
                      className="rounded text-blue-600"
                    />
                    {dept} {dept === 'AIML' ? '(+CSE)' : ''}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? 'Creating…' : 'Create Staff Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT STAFF MODAL */}
      <Modal
        isOpen={Boolean(editTarget)}
        title={`Edit Staff: ${editTarget?.email || ''}`}
        onClose={() => setEditTarget(null)}
      >
        {editTarget && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input
                type="text"
                required
                className="input-field"
                value={editTarget.name}
                onChange={e => setEditTarget({ ...editTarget, name: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Institutional Email</label>
              <input
                type="email"
                required
                className="input-field"
                value={editTarget.email}
                onChange={e => setEditTarget({ ...editTarget, email: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Role</label>
                <select
                  className="input-field"
                  value={editTarget.role}
                  onChange={e => setEditTarget({ ...editTarget, role: e.target.value })}
                >
                  {ROLES_LIST.map(r => (
                    <option key={r.value} value={r.value}>{r.label} ({r.value})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Status</label>
                <select
                  className="input-field"
                  value={editTarget.isActive ? 'true' : 'false'}
                  onChange={e => setEditTarget({ ...editTarget, isActive: e.target.value === 'true' })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive / Suspended</option>
                </select>
              </div>
            </div>

            {editTarget.role === 'HOD' && (
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-2">
                <label className="label">Department Scope Assignment *</label>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {CANONICAL_DEPARTMENTS.map(dept => (
                    <label key={dept} className="flex items-center gap-2 text-xs font-semibold text-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(editTarget.departmentScopes || []).includes(dept)}
                        onChange={() => toggleDeptScope(dept, true)}
                        className="rounded text-blue-600"
                      />
                      {dept} {dept === 'AIML' ? '(+CSE)' : ''}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditTarget(null)} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={updating} className="btn-primary">
                {updating ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* RESET PASSWORD MODAL */}
      <Modal
        isOpen={Boolean(resetTarget)}
        title={`Reset Password for ${resetTarget?.name || ''}`}
        onClose={() => setResetTarget(null)}
      >
        {resetTarget && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-xs text-gray-600">
              Set a new initial password for <span className="font-bold text-gray-900">{resetTarget.email}</span>. Plaintext passwords are never stored or logged.
            </p>
            <div>
              <label className="label">New Password *</label>
              <input
                type="password"
                required
                minLength={8}
                className="input-field"
                placeholder="At least 8 characters"
                value={resetPasswordVal}
                onChange={e => setResetPasswordVal(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setResetTarget(null)} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={resetting} className="btn-primary">
                {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
