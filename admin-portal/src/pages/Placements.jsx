import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
  companyName: '', jobRole: '', packageLPA: '', eligibility: '',
  description: '', registrationLink: '', driveDate: '', status: 'DRAFT', companyLogoUrl: '',
};

const STATUS_TABS = ['ALL', 'DRAFT', 'PUBLISHED', 'CLOSED'];

function SkeletonRows({ n = 5 }) {
  return [...Array(n)].map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="skeleton w-7 h-7 rounded" /><div className="skeleton h-4 w-32 rounded" /></div></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-28 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-20 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-7 w-24 rounded" /></td>
    </tr>
  ));
}

export default function Placements() {
  const { toasts, showToast, removeToast } = useToast();
  const [items,        setItems]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState('ALL');
  const [search,       setSearch]       = useState('');
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [form,         setForm]         = useState(INITIAL_FORM);
  const [saving,       setSaving]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/placements')
      .then(r => setItems(r.data))
      .catch(() => showToast('Failed to load placement drives', 'error'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = activeTab === 'ALL' ? items : items.filter(i => i.status === activeTab);
    if (search) list = list.filter(i =>
      i.companyName?.toLowerCase().includes(search.toLowerCase()) ||
      i.jobRole?.toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [items, activeTab, search]);

  const openCreate = () => { setEditing(null); setForm(INITIAL_FORM); setModalOpen(true); };
  const openEdit   = (item) => {
    setEditing(item);
    setForm({
      companyName: item.companyName, jobRole: item.jobRole, packageLPA: item.packageLPA,
      eligibility: item.eligibility, description: item.description,
      registrationLink: item.registrationLink, driveDate: item.driveDate ? item.driveDate.substring(0, 10) : '',
      status: item.status, companyLogoUrl: item.companyLogoUrl || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) { await api.put(`/admin/placements/${editing.id}`, form); showToast('Drive updated'); }
      else         { await api.post('/admin/placements', form);              showToast('Drive created'); }
      setModalOpen(false); load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try { await api.delete(`/admin/placements/${deleteTarget.id}`); showToast('Drive deleted'); setDeleteTarget(null); load(); }
    catch { showToast('Failed to delete', 'error'); }
  };

  const handlePublish = async (item) => {
    const newStatus = item.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    try { await api.put(`/admin/placements/${item.id}`, { status: newStatus }); showToast(`Drive ${newStatus === 'PUBLISHED' ? 'published' : 'unpublished'}`); load(); }
    catch { showToast('Failed to update', 'error'); }
  };

  const handleClose = async (item) => {
    try { await api.put(`/admin/placements/${item.id}`, { status: 'CLOSED' }); showToast('Drive closed'); load(); }
    catch { showToast('Failed to close', 'error'); }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="space-y-5 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader
        title="Placement Drives"
        subtitle={`${items.length} total drives`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search company or role…" />
            <button onClick={openCreate} className="btn-primary">
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create Drive
            </button>
          </>
        }
      />

      {/* Status Filter Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
            {tab !== 'ALL' && (
              <span className={`ml-1.5 ${activeTab === tab ? 'text-gray-400' : 'text-gray-300'}`}>
                ({items.filter(i => i.status === tab).length})
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th className="th">Company</th><th className="th">Role</th><th className="th">Package</th><th className="th">Date</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead><tbody><SkeletonRows /></tbody></table></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="work"
            title={search || activeTab !== 'ALL' ? 'No matching drives' : 'No placement drives yet'}
            description={!search && activeTab === 'ALL' ? 'Create your first placement drive to start recruiting.' : undefined}
            action={!search && activeTab === 'ALL' && <button onClick={openCreate} className="btn-primary">Create First Drive</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">Company</th><th className="th">Role</th>
                  <th className="th">Package</th><th className="th">Drive Date</th>
                  <th className="th">Status</th><th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id} className="tr-hover">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        {item.companyLogoUrl
                          ? <img src={item.companyLogoUrl} alt={item.companyName} className="w-8 h-8 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
                          : <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-blue-600">{item.companyName?.[0]}</span></div>
                        }
                        <span className="font-semibold text-gray-900 text-sm">{item.companyName}</span>
                      </div>
                    </td>
                    <td className="td text-gray-600">{item.jobRole}</td>
                    <td className="td font-semibold text-gray-800 whitespace-nowrap">{item.packageLPA} <span className="text-xs font-normal text-gray-400">LPA</span></td>
                    <td className="td text-xs text-gray-400 whitespace-nowrap">
                      {item.driveDate ? new Date(item.driveDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="td"><Badge value={item.status} /></td>
                    <td className="td">
                      <div className="flex items-center gap-1.5 justify-end">
                        {item.status === 'DRAFT' && (
                          <button onClick={() => handlePublish(item)} className="text-xs px-2.5 py-1 rounded-md bg-green-50 hover:bg-green-100 text-green-700 font-semibold transition-colors">Publish</button>
                        )}
                        {item.status === 'PUBLISHED' && (
                          <>
                            <button onClick={() => handlePublish(item)} className="text-xs px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold transition-colors">Unpublish</button>
                            <button onClick={() => handleClose(item)} className="text-xs px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-colors">Close</button>
                          </>
                        )}
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
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Placement Drive' : 'Create Placement Drive'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Company Name *</label><input className="input-field" value={form.companyName} onChange={f('companyName')} placeholder="e.g. TCS" required autoFocus /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Job Role *</label><input className="input-field" value={form.jobRole} onChange={f('jobRole')} placeholder="e.g. Software Engineer" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Package (LPA) *</label><input type="number" step="0.1" min="0" className="input-field" value={form.packageLPA} onChange={f('packageLPA')} placeholder="e.g. 6.5" required /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Drive Date *</label><input type="date" className="input-field" value={form.driveDate} onChange={f('driveDate')} required /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Eligibility Criteria *</label><input className="input-field" value={form.eligibility} onChange={f('eligibility')} placeholder="e.g. 60% aggregate, no active backlogs" required /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Description *</label><textarea className="input-field h-24 resize-none" value={form.description} onChange={f('description')} placeholder="Job description, requirements, etc." required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Registration Link *</label><input type="url" className="input-field" value={form.registrationLink} onChange={f('registrationLink')} placeholder="https://" required /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Company Logo URL</label><input type="url" className="input-field" value={form.companyLogoUrl} onChange={f('companyLogoUrl')} placeholder="https://…" /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Status</label>
            <select className="input-field" value={form.status} onChange={f('status')}>
              <option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="CLOSED">Closed</option>
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : editing ? 'Update Drive' : 'Create Drive'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Placement Drive" message={`Delete the drive for "${deleteTarget?.companyName}"? This cannot be undone.`} confirmText="Delete" danger />
    </div>
  );
}
