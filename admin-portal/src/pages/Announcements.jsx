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

const INITIAL_FORM = { title: '', description: '', priority: 'NORMAL', link: '', status: 'DRAFT' };

function SkeletonRows({ n = 5 }) {
  return [...Array(n)].map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      <td className="px-4 py-3"><div className="skeleton h-4 w-48 rounded mb-1" /><div className="skeleton h-3 w-64 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-16 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-20 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-7 w-24 rounded" /></td>
    </tr>
  ));
}

export default function Announcements() {
  const { toasts, showToast, removeToast } = useToast();
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modalOpen,   setModalOpen]   = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [form,        setForm]        = useState(INITIAL_FORM);
  const [saving,      setSaving]      = useState(false);
  const [deleteTarget,setDeleteTarget]= useState(null);
  const [search,      setSearch]      = useState('');

  const load = () => {
    setLoading(true);
    api.get('/admin/announcements')
      .then(r => setItems(r.data))
      .catch(() => showToast('Failed to load announcements', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() =>
    items.filter(i =>
      !search ||
      i.title?.toLowerCase().includes(search.toLowerCase()) ||
      i.description?.toLowerCase().includes(search.toLowerCase())
    ), [items, search]);

  const openCreate = () => { setEditing(null); setForm(INITIAL_FORM); setModalOpen(true); };
  const openEdit   = (item) => {
    setEditing(item);
    setForm({ title: item.title, description: item.description, priority: item.priority, link: item.link || '', status: item.status });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) { await api.put(`/admin/announcements/${editing.id}`, form); showToast('Announcement updated'); }
      else         { await api.post('/admin/announcements', form);              showToast('Announcement created'); }
      setModalOpen(false); load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/admin/announcements/${deleteTarget.id}`);
      showToast('Announcement deleted');
      setDeleteTarget(null); load();
    } catch { showToast('Failed to delete', 'error'); }
  };

  const togglePublish = async (item) => {
    const newStatus = item.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    try {
      await api.put(`/admin/announcements/${item.id}`, { status: newStatus });
      showToast(`Announcement ${newStatus === 'PUBLISHED' ? 'published' : 'unpublished'}`);
      load();
    } catch { showToast('Failed to update status', 'error'); }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="space-y-5 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader
        title="Announcements"
        subtitle={`${items.length} total`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search announcements…" />
            <button onClick={openCreate} className="btn-primary">
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create
            </button>
          </>
        }
      />

      <div className="card overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th className="th">Title</th><th className="th">Priority</th><th className="th">Status</th><th className="th">Date</th><th className="th text-right">Actions</th></tr></thead>
              <tbody><SkeletonRows /></tbody>
            </table>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="campaign"
            title={search ? 'No results found' : 'No announcements yet'}
            description={search ? `No announcements match "${search}"` : 'Create your first announcement to notify students.'}
            action={!search && <button onClick={openCreate} className="btn-primary">Create First Announcement</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">Title</th>
                  <th className="th">Priority</th>
                  <th className="th">Status</th>
                  <th className="th">Date</th>
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
                    <td className="td"><Badge value={item.priority} /></td>
                    <td className="td"><Badge value={item.status} /></td>
                    <td className="td text-xs text-gray-400 whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => togglePublish(item)}
                          className={`text-xs px-2.5 py-1 rounded-md font-semibold transition-colors ${
                            item.status === 'PUBLISHED'
                              ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                              : 'bg-green-50 hover:bg-green-100 text-green-700'
                          }`}
                        >
                          {item.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                        </button>
                        <button onClick={() => openEdit(item)} className="btn-icon" title="Edit">
                          <span className="material-symbols-outlined text-[17px]">edit</span>
                        </button>
                        <button onClick={() => setDeleteTarget(item)} className="btn-icon text-red-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                          <span className="material-symbols-outlined text-[17px]">delete</span>
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

      {/* Create / Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Announcement' : 'Create Announcement'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Title *</label>
            <input className="input-field" value={form.title} onChange={f('title')} placeholder="Announcement title" required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description *</label>
            <textarea className="input-field h-28 resize-none" value={form.description} onChange={f('description')} placeholder="Write the announcement details…" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Priority</label>
              <select className="input-field" value={form.priority} onChange={f('priority')}>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Status</label>
              <select className="input-field" value={form.status} onChange={f('status')}>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Link (optional)</label>
            <input type="url" className="input-field" placeholder="https://" value={form.link} onChange={f('link')} />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Announcement"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
