import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const INITIAL_FORM = {
  title: '', description: '', dueDate: '', targetBatch: 'ALL',
  priority: 'NORMAL', popupEnabled: false, notificationEnabled: false,
};

function getDueBadge(dueDate) {
  if (!dueDate) return null;
  const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0)  return <span className="text-[10px] font-semibold text-red-500">Overdue</span>;
  if (days <= 3) return <span className="text-[10px] font-semibold text-red-500">{days}d left</span>;
  if (days <= 7) return <span className="text-[10px] font-semibold text-amber-600">{days}d left</span>;
  return <span className="text-[10px] font-semibold text-gray-400">{days}d left</span>;
}

function SkeletonRows({ n = 5 }) {
  return [...Array(n)].map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      <td className="px-4 py-3"><div className="skeleton h-4 w-48 rounded mb-1" /><div className="skeleton h-3 w-64 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-14 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-8 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-14 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-7 w-24 rounded" /></td>
    </tr>
  ));
}

export default function FeeNotices() {
  const { toasts, showToast, removeToast } = useToast();
  const [items,        setItems]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [form,         setForm]         = useState(INITIAL_FORM);
  const [saving,       setSaving]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search,       setSearch]       = useState('');

  const load = () => {
    setLoading(true);
    api.get('/admin/fee-notices')
      .then(r => setItems(r.data))
      .catch(() => showToast('Failed to load fee notices', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() =>
    items.filter(i => !search || i.title?.toLowerCase().includes(search.toLowerCase()) || i.targetBatch?.toLowerCase().includes(search.toLowerCase())),
  [items, search]);

  const openCreate = () => { setEditing(null); setForm(INITIAL_FORM); setModalOpen(true); };
  const openEdit   = (item) => {
    setEditing(item);
    setForm({
      title: item.title, description: item.description,
      dueDate: item.dueDate ? item.dueDate.substring(0, 10) : '',
      targetBatch: item.targetBatch || 'ALL', priority: item.priority || 'NORMAL',
      popupEnabled: !!item.popupEnabled, notificationEnabled: !!item.notificationEnabled,
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) { await api.put(`/admin/fee-notices/${editing.id}`, form); showToast('Fee notice updated'); }
      else         { await api.post('/admin/fee-notices', form);              showToast('Fee notice created'); }
      setModalOpen(false); load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try { await api.delete(`/admin/fee-notices/${deleteTarget.id}`); showToast('Fee notice deleted'); setDeleteTarget(null); load(); }
    catch { showToast('Failed to delete', 'error'); }
  };

  const toggleActive = async (item) => {
    try { await api.put(`/admin/fee-notices/${item.id}`, { isActive: !item.isActive }); showToast(`Notice ${!item.isActive ? 'activated' : 'deactivated'}`); load(); }
    catch { showToast('Failed to update', 'error'); }
  };

  const f      = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  const fCheck = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.checked }));

  return (
    <div className="space-y-5 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader
        title="Fee Notices"
        subtitle={`${items.length} total notices`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search notices…" />
            <button onClick={openCreate} className="btn-primary">
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create Notice
            </button>
          </>
        }
      />

      <div className="card overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th className="th">Title</th><th className="th">Due Date</th><th className="th">Batch</th><th className="th">Priority</th><th className="th">Popup</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead><tbody><SkeletonRows /></tbody></table></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="receipt_long" title={search ? 'No results found' : 'No fee notices yet'} action={!search && <button onClick={openCreate} className="btn-primary">Create First Notice</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">Title</th><th className="th">Due Date</th><th className="th">Batch</th>
                  <th className="th">Priority</th><th className="th">Popup</th><th className="th">Status</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id} className="tr-hover">
                    <td className="td">
                      <p className="font-semibold text-gray-900 text-sm leading-snug">{item.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 max-w-sm truncate">{item.description}</p>
                    </td>
                    <td className="td whitespace-nowrap">
                      <p className="text-xs text-gray-700">{item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</p>
                      {getDueBadge(item.dueDate)}
                    </td>
                    <td className="td text-xs text-gray-500">{item.targetBatch || 'ALL'}</td>
                    <td className="td"><Badge value={item.priority} /></td>
                    <td className="td">
                      {item.popupEnabled
                        ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold"><span className="material-symbols-outlined text-[14px]">check_circle</span>On</span>
                        : <span className="text-xs text-gray-400">Off</span>}
                    </td>
                    <td className="td"><Badge value={item.isActive ? 'active' : 'inactive'} label={item.isActive ? 'Active' : 'Inactive'} /></td>
                    <td className="td">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => toggleActive(item)} className={`text-xs px-2.5 py-1 rounded-md font-semibold transition-colors ${item.isActive ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : 'bg-green-50 hover:bg-green-100 text-green-700'}`}>
                          {item.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => openEdit(item)} className="btn-icon" title="Edit"><span className="material-symbols-outlined text-[17px]">edit</span></button>
                        <button onClick={() => setDeleteTarget(item)} className="btn-icon text-red-400 hover:bg-red-50 hover:text-red-600" title="Delete"><span className="material-symbols-outlined text-[17px]">delete</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Fee Notice' : 'Create Fee Notice'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Title *</label><input className="input-field" value={form.title} onChange={f('title')} placeholder="e.g. Semester Fee Payment – August 2024" required autoFocus /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Description *</label><textarea className="input-field h-24 resize-none" value={form.description} onChange={f('description')} placeholder="Details about fee payment, amount, modes of payment…" required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Due Date *</label><input type="date" className="input-field" value={form.dueDate} onChange={f('dueDate')} required /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Batch</label><input className="input-field" value={form.targetBatch} onChange={f('targetBatch')} placeholder="ALL / 2024 / CSE-2024" /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Priority</label>
            <select className="input-field" value={form.priority} onChange={f('priority')}><option value="NORMAL">Normal</option><option value="HIGH">High</option></select>
          </div>
          <div className="space-y-3 bg-gray-50 rounded-xl p-4 border border-gray-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500/20" checked={form.popupEnabled} onChange={fCheck('popupEnabled')} />
              <div><p className="text-sm font-medium text-gray-700">Enable Popup</p><p className="text-xs text-gray-400">Show popup to students on the mobile app</p></div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500/20" checked={form.notificationEnabled} onChange={fCheck('notificationEnabled')} />
              <div><p className="text-sm font-medium text-gray-700">Send Push Notification</p><p className="text-xs text-gray-400">Push notification when notice is created</p></div>
            </label>
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : editing ? 'Update Notice' : 'Create Notice'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Fee Notice" message={`Delete "${deleteTarget?.title}"? This cannot be undone.`} confirmText="Delete" danger />
    </div>
  );
}
