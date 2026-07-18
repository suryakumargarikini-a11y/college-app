import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDialog from '../components/ConfirmDialog';

const INITIAL_FORM = {
  title: '',
  description: '',
  subject: '',
  category: 'GENERAL',
  branch: '',
  semester: '',
  section: '',
  academicYear: ''
};

export default function ELibrary() {
  const { toasts, showToast, removeToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('');
  
  // Modals state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  
  // Form states
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingItem, setEditingItem] = useState(null);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [file, setFile] = useState(null);
  const [replaceFile, setReplaceFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/library/admin/materials')
      .then(r => setItems(r.data))
      .catch(() => showToast('Failed to load materials', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Filter and search logic
  const filtered = useMemo(() => {
    return items.filter(m => {
      const matchesSearch = !search || 
        [m.title, m.subject, m.category, m.originalFileName].some(x => 
          x?.toLowerCase().includes(search.toLowerCase())
        );
      const matchesCategory = categoryFilter === 'ALL' || m.category === categoryFilter;
      const matchesSubject = !subjectFilter || m.subject?.toLowerCase().includes(subjectFilter.toLowerCase());
      return matchesSearch && matchesCategory && matchesSubject;
    });
  }, [items, search, categoryFilter, subjectFilter]);

  // Extract unique subjects for the filter dropdown
  const uniqueSubjects = useMemo(() => {
    const subs = items.map(m => m.subject).filter(Boolean);
    return Array.from(new Set(subs)).sort();
  }, [items]);

  const handleFieldChange = (key) => (e) => {
    setForm(p => ({ ...p, [key]: e.target.value }));
  };

  const openUploadModal = () => {
    setForm(INITIAL_FORM);
    setFile(null);
    setUploadOpen(true);
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!file) return showToast('Please select a file to upload', 'error');
    setSaving(true);
    
    try {
      await api.post(`/library/admin/materials?${new URLSearchParams(form)}`, file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': file.name
        }
      });
      setUploadOpen(false);
      load();
      showToast('Material uploaded successfully', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setForm({
      title: item.title || '',
      description: item.description || '',
      subject: item.subject || '',
      category: item.category || 'GENERAL',
      branch: item.branch || '',
      semester: item.semester || '',
      section: item.section || '',
      academicYear: item.academicYear || ''
    });
    setEditOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/library/admin/materials/${editingItem.id}`, form);
      setEditOpen(false);
      load();
      showToast('Material details updated successfully', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openReplaceModal = (item) => {
    setReplaceTarget(item);
    setReplaceFile(null);
    setReplaceOpen(true);
  };

  const handleReplaceSubmit = async (e) => {
    e.preventDefault();
    if (!replaceFile) return showToast('Please select a replacement file', 'error');
    setSaving(true);
    try {
      await api.put(`/library/admin/materials/${replaceTarget.id}/file`, replaceFile, {
        headers: {
          'Content-Type': replaceFile.type || 'application/octet-stream',
          'X-File-Name': replaceFile.name
        }
      });
      setReplaceOpen(false);
      load();
      showToast('File replaced successfully', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'File replacement failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (item) => {
    try {
      await api.post(`/library/admin/materials/${item.id}/archive`);
      load();
      showToast('Material archived successfully', 'success');
    } catch (err) {
      showToast('Failed to archive material', 'error');
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/library/admin/materials/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
      showToast('Material permanently deleted', 'success');
    } catch (err) {
      showToast('Failed to delete material', 'error');
    }
  };

  const downloadFile = async (m) => {
    try {
      showToast('Starting file download...', 'info');
      const res = await api.get(`/library/materials/${m.id}/content?download=true`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', m.originalFileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      showToast('Download failed', 'error');
    }
  };

  const previewFile = async (m) => {
    try {
      showToast('Opening file preview...', 'info');
      const res = await api.get(`/library/materials/${m.id}/content`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: m.mimeType });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      showToast('Preview not available or failed to load', 'error');
    }
  };

  return (
    <div className="space-y-5 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader
        title="E-Library Catalog"
        subtitle={`${items.length} materials published`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search catalog…" />
            <button className="btn-primary" onClick={openUploadModal}>
              <span className="material-symbols-outlined text-[18px]">upload</span>
              Upload Material
            </button>
          </>
        }
      />

      {/* Filters Hub */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center justify-between bg-white/50 backdrop-blur-md">
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {['ALL', 'NOTES', 'ASSIGNMENT', 'REFERENCE', 'GENERAL'].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                categoryFilter === cat
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          <select
            className="input-field py-1.5 text-xs font-semibold w-full md:w-48 bg-white"
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
          >
            <option value="">All Subjects</option>
            {uniqueSubjects.map(sub => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Material Grid / Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading catalog...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="local_library"
            title="No Materials Found"
            description={search || categoryFilter !== 'ALL' || subjectFilter ? 'No materials match your active search/filter rules.' : 'Upload study materials, notes, or references for targeting students.'}
            action={!search && categoryFilter === 'ALL' && !subjectFilter && (
              <button className="btn-primary" onClick={openUploadModal}>Upload First Material</button>
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="th">Material Title &amp; Category</th>
                  <th className="th">Subject</th>
                  <th className="th">Student targeting rules</th>
                  <th className="th">File Properties</th>
                  <th className="th">Uploaded By</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr className="tr-hover" key={m.id}>
                    <td className="td">
                      <div className="font-bold text-slate-800 text-sm leading-snug">{m.title}</div>
                      {m.description && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{m.description}</div>}
                    </td>
                    <td className="td">
                      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {m.subject || 'General'}
                      </span>
                    </td>
                    <td className="td text-xs font-semibold text-slate-600">
                      {[
                        m.branch && `${m.branch}`,
                        m.semester && `Sem ${m.semester}`,
                        m.section && `Sec ${m.section}`,
                        m.academicYear && `Year ${m.academicYear}`
                      ].filter(Boolean).join(' · ') || <span className="text-slate-400 font-bold uppercase">All Students</span>}
                    </td>
                    <td className="td text-xs text-slate-500 font-medium">
                      <span className="font-bold text-slate-700 uppercase">{m.fileType}</span> · {(m.fileSize / 1024 / 1024).toFixed(2)} MB
                    </td>
                    <td className="td text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{m.uploadedBy}</span>
                      <span className="block text-[10px] text-slate-400 capitalize">{m.uploadedByRole?.toLowerCase().replace('_', ' ')}</span>
                    </td>
                    <td className="td">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                        m.isActive
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {m.isActive ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td className="td text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button className="btn-icon text-slate-500 hover:bg-slate-50" title="Preview" onClick={() => previewFile(m)}>
                          <span className="material-symbols-outlined text-[17px]">visibility</span>
                        </button>
                        <button className="btn-icon text-slate-500 hover:bg-slate-50" title="Download" onClick={() => downloadFile(m)}>
                          <span className="material-symbols-outlined text-[17px]">download</span>
                        </button>
                        <button className="btn-icon text-slate-500 hover:bg-slate-50" title="Replace File" onClick={() => openReplaceModal(m)}>
                          <span className="material-symbols-outlined text-[17px]">file_upload_off</span>
                        </button>
                        <button className="btn-icon text-slate-500 hover:bg-slate-50" title="Edit Metadata" onClick={() => openEditModal(m)}>
                          <span className="material-symbols-outlined text-[17px]">edit</span>
                        </button>
                        {m.isActive && (
                          <button className="btn-icon text-slate-500 hover:bg-slate-50" title="Archive" onClick={() => handleArchive(m)}>
                            <span className="material-symbols-outlined text-[17px]">archive</span>
                          </button>
                        )}
                        <button className="btn-icon text-red-450 hover:bg-red-50 hover:text-red-600" title="Delete" onClick={() => setDeleteTarget(m)}>
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

      {/* Upload Modal */}
      <Modal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload Study Material">
        <form className="space-y-4" onSubmit={handleUploadSubmit}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
              <input className="input-field" required placeholder="E.g., Linked Lists Handout" value={form.title} onChange={handleFieldChange('title')} />
            </div>
            
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Description (optional)</label>
              <textarea className="input-field h-20 resize-none" placeholder="Provide extra detail about this file..." value={form.description} onChange={handleFieldChange('description')} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Subject *</label>
              <input className="input-field" required placeholder="E.g., Data Structures" value={form.subject} onChange={handleFieldChange('subject')} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Category</label>
              <select className="input-field bg-white" value={form.category} onChange={handleFieldChange('category')}>
                <option value="GENERAL">GENERAL</option>
                <option value="NOTES">NOTES</option>
                <option value="ASSIGNMENT">ASSIGNMENT</option>
                <option value="REFERENCE">REFERENCE</option>
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100 my-2 pt-2">
            <p className="text-xs uppercase tracking-wider font-extrabold text-blue-600 mb-3">Student Access Targeting</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Branch (optional)</label>
                <input className="input-field" placeholder="E.g. COMPUTER SCIENCE ENGINEERING" value={form.branch} onChange={handleFieldChange('branch')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Semester (optional)</label>
                <input className="input-field" placeholder="E.g. 3" value={form.semester} onChange={handleFieldChange('semester')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Section (optional)</label>
                <input className="input-field" placeholder="E.g. A" value={form.section} onChange={handleFieldChange('section')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year (optional)</label>
                <input className="input-field" placeholder="E.g. 2025-26" value={form.academicYear} onChange={handleFieldChange('academicYear')} />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Choose File *</label>
            <input 
              type="file" 
              className="input-field text-xs cursor-pointer" 
              required 
              accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif" 
              onChange={e => setFile(e.target.files[0])} 
            />
            <p className="text-[10px] text-slate-400 mt-1">Supports PDF, Office (DOCX, PPTX, XLSX), PNG, JPG, GIF up to 25MB.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" type="button" onClick={() => setUploadOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={saving} type="submit">
              {saving ? 'Uploading...' : 'Publish Material'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Metadata Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit Material Metadata">
        <form className="space-y-4" onSubmit={handleEditSubmit}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
              <input className="input-field" required value={form.title} onChange={handleFieldChange('title')} />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
              <textarea className="input-field h-20 resize-none" value={form.description} onChange={handleFieldChange('description')} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Subject</label>
              <input className="input-field" value={form.subject} onChange={handleFieldChange('subject')} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Category</label>
              <select className="input-field bg-white" value={form.category} onChange={handleFieldChange('category')}>
                <option value="GENERAL">GENERAL</option>
                <option value="NOTES">NOTES</option>
                <option value="ASSIGNMENT">ASSIGNMENT</option>
                <option value="REFERENCE">REFERENCE</option>
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100 my-2 pt-2">
            <p className="text-xs uppercase tracking-wider font-extrabold text-blue-600 mb-3">Targeting Constraints</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Branch</label>
                <input className="input-field" value={form.branch} onChange={handleFieldChange('branch')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
                <input className="input-field" value={form.semester} onChange={handleFieldChange('semester')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Section</label>
                <input className="input-field" value={form.section} onChange={handleFieldChange('section')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
                <input className="input-field" value={form.academicYear} onChange={handleFieldChange('academicYear')} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" type="button" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={saving} type="submit">
              {saving ? 'Updating...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Replace File Modal */}
      <Modal isOpen={replaceOpen} onClose={() => setReplaceOpen(false)} title="Replace Material File">
        <form className="space-y-4" onSubmit={handleReplaceSubmit}>
          <div className="p-3.5 bg-blue-50/60 rounded-2xl border border-blue-100/60 text-xs text-blue-800 leading-relaxed">
            <span className="font-bold">Replacing file for:</span> {replaceTarget?.title}
            <span className="block text-[11px] text-blue-600 font-mono mt-1">Current file: {replaceTarget?.originalFileName} ({replaceTarget?.fileType})</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Choose New File *</label>
            <input 
              type="file" 
              className="input-field text-xs cursor-pointer" 
              required 
              accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif" 
              onChange={e => setReplaceFile(e.target.files[0])} 
            />
            <p className="text-[10px] text-slate-400 mt-1">Replacing the file will retain all targeting rules and metadata, but update the file binary, type, size, and download link.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" type="button" onClick={() => setReplaceOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={saving} type="submit">
              {saving ? 'Replacing...' : 'Replace File'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Material"
        message={`Are you sure you want to permanently delete "${deleteTarget?.title}"? This will erase the file from storage and remove all download metrics.`}
        confirmText="Delete permanently"
        danger
      />
    </div>
  );
}
