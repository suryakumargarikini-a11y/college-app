import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const INITIAL_FORM = {
  title: '',
  description: '',
  dueDate: '',
  targetBatch: 'ALL',
  priority: 'NORMAL',
  popupEnabled: false,
  notificationEnabled: false,
};

export default function FeeNotices() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = () => {
    setLoading(true);
    api.get('/admin/fee-notices')
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(INITIAL_FORM);
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      title: item.title,
      description: item.description,
      dueDate: item.dueDate ? item.dueDate.substring(0, 10) : '',
      targetBatch: item.targetBatch || 'ALL',
      priority: item.priority || 'NORMAL',
      popupEnabled: !!item.popupEnabled,
      notificationEnabled: !!item.notificationEnabled,
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/admin/fee-notices/${editing.id}`, form);
        showToast('Fee notice updated');
      } else {
        await api.post('/admin/fee-notices', form);
        showToast('Fee notice created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/admin/fee-notices/${deleteTarget.id}`);
      showToast('Fee notice deleted');
      setDeleteTarget(null);
      load();
    } catch {
      showToast('Failed to delete');
    }
  };

  const toggleActive = async (item) => {
    try {
      await api.put(`/admin/fee-notices/${item.id}`, { isActive: !item.isActive });
      showToast(`Notice ${!item.isActive ? 'activated' : 'deactivated'}`);
      load();
    } catch {
      showToast('Failed to update');
    }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  const fCheck = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.checked }));

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Fee Notices</h2>
          <p className="text-sm text-gray-500">{items.length} total notices</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
          Create Notice
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-gray-300 text-5xl block">receipt_long</span>
            <p className="text-sm text-gray-500 mt-2">No fee notices yet</p>
            <button onClick={openCreate} className="btn-primary mt-4">Create First Notice</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Due Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Target Batch</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Priority</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Popup</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">{item.description}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{item.targetBatch || 'ALL'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge-${item.priority?.toLowerCase()}`}>{item.priority}</span>
                    </td>
                    <td className="px-4 py-3">
                      {item.popupEnabled ? (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span> On
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={item.isActive ? 'badge-active' : 'badge-inactive'}>
                        {item.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => toggleActive(item)}
                          className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                            item.isActive
                              ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                              : 'bg-green-50 hover:bg-green-100 text-green-700'
                          }`}
                        >
                          {item.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 hover:bg-gray-100 rounded text-gray-600 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                        </button>
                        <button
                          onClick={() => setDeleteTarget(item)}
                          className="p-1.5 hover:bg-red-50 rounded text-red-500 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Fee Notice' : 'Create Fee Notice'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input className="input-field" value={form.title} onChange={f('title')} placeholder="e.g. Semester Fee Payment - August 2024" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <textarea
              className="input-field h-24 resize-none"
              value={form.description}
              onChange={f('description')}
              placeholder="Details about the fee payment, amount, modes of payment, etc."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date *</label>
              <input type="date" className="input-field" value={form.dueDate} onChange={f('dueDate')} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Batch</label>
              <input
                className="input-field"
                value={form.targetBatch}
                onChange={f('targetBatch')}
                placeholder="ALL / 2024 / CSE-2024"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <select className="input-field" value={form.priority} onChange={f('priority')}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </select>
          </div>

          <div className="space-y-3 pt-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                checked={form.popupEnabled}
                onChange={fCheck('popupEnabled')}
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Enable Popup</p>
                <p className="text-xs text-gray-500">Show a popup notification to students on the mobile app</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                checked={form.notificationEnabled}
                onChange={fCheck('notificationEnabled')}
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Send Push Notification</p>
                <p className="text-xs text-gray-500">Send a push notification to students when notice is created</p>
              </div>
            </label>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Update Notice' : 'Create Notice'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Fee Notice"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
