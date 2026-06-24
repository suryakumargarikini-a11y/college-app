import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const INITIAL_FORM = {
  companyName: '',
  jobRole: '',
  packageLPA: '',
  eligibility: '',
  description: '',
  registrationLink: '',
  driveDate: '',
  status: 'DRAFT',
  companyLogoUrl: '',
};

export default function Placements() {
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
    api.get('/admin/placements')
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
      companyName: item.companyName,
      jobRole: item.jobRole,
      packageLPA: item.packageLPA,
      eligibility: item.eligibility,
      description: item.description,
      registrationLink: item.registrationLink,
      driveDate: item.driveDate ? item.driveDate.substring(0, 10) : '',
      status: item.status,
      companyLogoUrl: item.companyLogoUrl || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/admin/placements/${editing.id}`, form);
        showToast('Placement drive updated');
      } else {
        await api.post('/admin/placements', form);
        showToast('Placement drive created');
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
      await api.delete(`/admin/placements/${deleteTarget.id}`);
      showToast('Placement drive deleted');
      setDeleteTarget(null);
      load();
    } catch {
      showToast('Failed to delete');
    }
  };

  const handlePublish = async (item) => {
    const newStatus = item.status === 'PUBLISHED' ? 'DRAFT' : item.status === 'CLOSED' ? 'CLOSED' : 'PUBLISHED';
    try {
      await api.put(`/admin/placements/${item.id}`, { status: newStatus });
      showToast(`Drive ${newStatus === 'PUBLISHED' ? 'published' : 'unpublished'}`);
      load();
    } catch {
      showToast('Failed to update status');
    }
  };

  const handleClose = async (item) => {
    try {
      await api.put(`/admin/placements/${item.id}`, { status: 'CLOSED' });
      showToast('Drive closed');
      load();
    } catch {
      showToast('Failed to close drive');
    }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

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
          <h2 className="text-lg font-semibold text-gray-900">Placement Drives</h2>
          <p className="text-sm text-gray-500">{items.length} total drives</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
          Create Drive
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
            <span className="material-symbols-outlined text-gray-300 text-5xl block">work</span>
            <p className="text-sm text-gray-500 mt-2">No placement drives yet</p>
            <button onClick={openCreate} className="btn-primary mt-4">Create First Drive</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Package</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Drive Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {item.companyLogoUrl ? (
                          <img src={item.companyLogoUrl} alt={item.companyName} className="w-7 h-7 rounded object-cover border border-gray-200" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-blue-100 flex items-center justify-center">
                            <span className="text-xs font-bold text-blue-700">{item.companyName?.[0]}</span>
                          </div>
                        )}
                        <p className="text-sm font-medium text-gray-900">{item.companyName}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.jobRole}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.packageLPA} LPA</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {item.driveDate ? new Date(item.driveDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge-${item.status?.toLowerCase()}`}>{item.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {item.status === 'DRAFT' && (
                          <button
                            onClick={() => handlePublish(item)}
                            className="text-xs px-2 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 font-medium transition-colors"
                          >
                            Publish
                          </button>
                        )}
                        {item.status === 'PUBLISHED' && (
                          <>
                            <button
                              onClick={() => handlePublish(item)}
                              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
                            >
                              Unpublish
                            </button>
                            <button
                              onClick={() => handleClose(item)}
                              className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-colors"
                            >
                              Close
                            </button>
                          </>
                        )}
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
        title={editing ? 'Edit Placement Drive' : 'Create Placement Drive'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
              <input className="input-field" value={form.companyName} onChange={f('companyName')} placeholder="e.g. TCS" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Role *</label>
              <input className="input-field" value={form.jobRole} onChange={f('jobRole')} placeholder="e.g. Software Engineer" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Package (LPA) *</label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="input-field"
                value={form.packageLPA}
                onChange={f('packageLPA')}
                placeholder="e.g. 6.5"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Drive Date *</label>
              <input type="date" className="input-field" value={form.driveDate} onChange={f('driveDate')} required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Eligibility Criteria *</label>
            <input
              className="input-field"
              value={form.eligibility}
              onChange={f('eligibility')}
              placeholder="e.g. 60% aggregate, no active backlogs"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <textarea
              className="input-field h-24 resize-none"
              value={form.description}
              onChange={f('description')}
              placeholder="Job description, requirements, etc."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Registration Link *</label>
              <input
                type="url"
                className="input-field"
                value={form.registrationLink}
                onChange={f('registrationLink')}
                placeholder="https://"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Logo URL (optional)</label>
              <input
                type="url"
                className="input-field"
                value={form.companyLogoUrl}
                onChange={f('companyLogoUrl')}
                placeholder="https://..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select className="input-field" value={form.status} onChange={f('status')}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Update Drive' : 'Create Drive'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Placement Drive"
        message={`Are you sure you want to delete the drive for "${deleteTarget?.companyName}"? This cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
