import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import { authStore } from '../store/authStore';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';

// Canonical production backend origin — used to resolve relative image URLs stored before the
// absolute-URL fix was deployed. New records already have absolute URLs.
const RAILWAY_BASE = 'https://api.sitam.co.in';

/**
 * Converts a stored imageUrl to an absolute URL.
 * - Already-absolute URLs (http/https) are returned unchanged.
 * - Relative paths like /api/achievements/images/... are prefixed with the Railway origin.
 */
function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  return `${RAILWAY_BASE}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
}

const CATEGORIES = [
  'Student', 'Faculty', 'Research', 'Sports',
  'Competition', 'Placement', 'Cultural', 'Other'
];

const DEPARTMENTS = [
  'ALL', 'CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'MBA', 'BSH'
];

const INITIAL_FORM = {
  title: '',
  description: '',
  category: 'Student',
  branch: 'CSE',
  participantName: '',
  achievementDate: new Date().toISOString().split('T')[0],
  isPublished: true,
  imageUrl: ''
};

export default function Achievements() {
  const { showToast } = useToast();
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adminUser, setAdminUser] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Form State
  const [form, setForm] = useState(INITIAL_FORM);
  const [editItem, setEditItem] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [saving, setSaving] = useState(false);

  // Read admin identity — try session store first, then refresh from server
  useEffect(() => {
    const loadAdminUser = async () => {
      setProfileLoading(true);
      // Read stored user first for immediate render
      try {
        const stored = authStore.getUser();
        if (stored) setAdminUser(stored);
      } catch (_) {}

      // Always refresh from /api/admin/auth/me — this guarantees `department` is current
      // even for sessions that predate the department field being included in login.
      try {
        const res = await api.get('/admin/auth/me');
        const fresh = res.data?.admin;
        if (fresh) {
          setAdminUser(fresh);
          // Update the stored user so other pages also see the department field
          const token = authStore.getToken();
          if (token) authStore.setAuth(token, fresh);
        }
      } catch (e) {
        console.warn('[Achievements] Could not refresh admin profile from server:', e?.message);
      } finally {
        setProfileLoading(false);
      }
    };
    loadAdminUser();
  }, []);

  const fetchAchievements = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/achievements');
      setAchievements(res.data || []);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load achievements', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAchievements();
  }, []);

  // Filtered achievements
  const filtered = useMemo(() => {
    return achievements.filter(a => {
      const matchesSearch = !search || [a.title, a.description, a.participantName, a.createdByName].some(
        x => x?.toLowerCase().includes(search.toLowerCase())
      );
      const matchesCat = categoryFilter === 'ALL' || a.category === categoryFilter;
      const matchesBranch = branchFilter === 'ALL' || a.branch === branchFilter || a.branch === 'ALL';
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'PUBLISHED' ? a.isPublished : !a.isPublished);

      return matchesSearch && matchesCat && matchesBranch && matchesStatus;
    });
  }, [achievements, search, categoryFilter, branchFilter, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = achievements.length;
    const published = achievements.filter(a => a.isPublished).length;
    const drafts = total - published;
    const categoriesCount = new Set(achievements.map(a => a.category)).size;
    return { total, published, drafts, categoriesCount };
  }, [achievements]);

  const handleFieldChange = (key) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(p => ({ ...p, [key]: val }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const openCreateModal = async () => {
    const isHodUser = adminUser?.role === 'HOD';

    // For HOD: department MUST come from the server. If profileLoading is still true
    // (i.e. user clicked before /admin/auth/me resolved), wait for it.
    if (isHodUser && !adminUser?.department) {
      if (profileLoading) {
        showToast('Loading your profile… please try again in a moment.', 'info');
        return;
      }
      // Profile load finished but department is still null — re-fetch on demand
      try {
        showToast('Resolving your department…', 'info');
        const res = await api.get('/admin/auth/me');
        const fresh = res.data?.admin;
        if (fresh) {
          setAdminUser(fresh);
          const token = authStore.getToken();
          if (token) authStore.setAuth(token, fresh);
          if (!fresh.department) {
            showToast('Your department could not be resolved. Contact the administrator.', 'error');
            return;
          }
          // Proceed with the resolved department
          setForm({ ...INITIAL_FORM, branch: fresh.department });
          setImageFile(null);
          setImagePreview('');
          setCreateOpen(true);
          return;
        }
      } catch (e) {
        showToast('Could not load your department. Please refresh the page.', 'error');
        return;
      }
    }

    setForm({
      ...INITIAL_FORM,
      branch: isHodUser ? adminUser.department : 'CSE'
    });
    setImageFile(null);
    setImagePreview('');
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return showToast('Title is required', 'error');
    if (!form.description.trim()) return showToast('Description is required', 'error');

    setSaving(true);
    try {
      if (imageFile) {
        // Upload image binary
        const queryParams = new URLSearchParams({
          title: form.title,
          description: form.description,
          category: form.category,
          branch: form.branch,
          participantName: form.participantName || '',
          achievementDate: form.achievementDate,
          isPublished: String(form.isPublished)
        });

        await api.post(`/admin/achievements?${queryParams}`, imageFile, {
          headers: {
            'Content-Type': imageFile.type || 'application/octet-stream',
            'X-File-Name': imageFile.name
          }
        });
      } else {
        await api.post('/admin/achievements', form);
      }

      showToast('Achievement created successfully', 'success');
      setCreateOpen(false);
      fetchAchievements();
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Failed to create achievement', 'error');
    } finally {
      setSaving(false);
    }
  };


  const openEditModal = (item) => {
    setEditItem(item);
    setForm({
      title: item.title || '',
      description: item.description || '',
      category: item.category || 'Student',
      branch: item.branch || 'CSE',
      participantName: item.participantName || '',
      achievementDate: item.achievementDate ? item.achievementDate.split('T')[0] : new Date().toISOString().split('T')[0],
      isPublished: Boolean(item.isPublished),
      imageUrl: item.imageUrl || ''
    });
    setImageFile(null);
    setImagePreview(item.imageUrl || '');
    setEditOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (imageFile) {
        // Single PUT: binary body + all metadata as query params
        // This avoids a second request overwriting the newly saved imageUrl.
        const queryParams = new URLSearchParams({
          title: form.title,
          description: form.description,
          category: form.category,
          branch: form.branch,
          participantName: form.participantName || '',
          achievementDate: form.achievementDate,
          isPublished: String(form.isPublished)
        });

        await api.put(`/admin/achievements/${editItem.id}?${queryParams}`, imageFile, {
          headers: {
            'Content-Type': imageFile.type || 'application/octet-stream',
            'X-File-Name': imageFile.name
          }
        });
      } else {
        // No image change — plain JSON update
        await api.put(`/admin/achievements/${editItem.id}`, form);
      }

      showToast('Achievement updated successfully', 'success');
      setEditOpen(false);
      fetchAchievements();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update achievement', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/admin/achievements/${deleteTarget.id}`);
      showToast('Achievement deleted successfully', 'success');
      setDeleteTarget(null);
      fetchAchievements();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete achievement', 'error');
    }
  };

  const togglePublishStatus = async (item) => {
    try {
      await api.put(`/admin/achievements/${item.id}`, {
        isPublished: !item.isPublished
      });
      showToast(`Achievement ${!item.isPublished ? 'published' : 'unpublished'}`, 'info');
      fetchAchievements();
    } catch (err) {
      showToast(err.response?.data?.error || 'Status update failed', 'error');
    }
  };

  const isHod = adminUser?.role === 'HOD';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branch Achievements"
        subtitle={isHod ? `Manage achievements for Department of ${adminUser?.department || 'your branch'}` : "Manage department and institutional achievements"}
        actions={
          <button
            onClick={openCreateModal}
            disabled={profileLoading && adminUser?.role === 'HOD'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 active:scale-95 text-white text-sm font-bold rounded-xl shadow-sm transition-all disabled:opacity-60 disabled:cursor-wait"
          >
            {profileLoading && adminUser?.role === 'HOD'
              ? <><span className="material-symbols-outlined text-base leading-none animate-spin">progress_activity</span> Loading…</>
              : <><span className="material-symbols-outlined text-base leading-none">add</span> Add Achievement</>
            }
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Achievements</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{stats.total}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-2xl">emoji_events</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Published</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{stats.published}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-2xl">visibility</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Draft / Unpublished</p>
            <p className="text-2xl font-black text-amber-600 mt-1">{stats.drafts}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-2xl">edit_note</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Categories</p>
            <p className="text-2xl font-black text-blue-600 mt-1">{stats.categoriesCount}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-2xl">category</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="w-full md:w-72">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search achievements..."
          />
        </div>

        <div className="flex flex-wrap gap-3 w-full md:w-auto items-center">
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-violet-500"
          >
            <option value="ALL">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Branch Filter */}
          {!isHod && (
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-violet-500"
            >
              <option value="ALL">All Branches</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-violet-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="PUBLISHED">Published Only</option>
            <option value="UNPUBLISHED">Unpublished Only</option>
          </select>
        </div>
      </div>

      {/* Grid of Achievements */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse p-4"></div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="emoji_events"
          title="No achievements found"
          description={search ? "Try adjusting your search filters" : "Click 'Add Achievement' to highlight your department's success stories."}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(a => {
            const dateStr = new Date(a.achievementDate).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric'
            });

            return (
              <div
                key={a.id}
                className="bg-white border border-slate-200/90 rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between"
              >
                <div>
                  {/* Photo or Category Header */}
                  {a.imageUrl ? (
                    <div className="h-44 bg-slate-100 relative overflow-hidden">
                      <img
                        src={resolveImageUrl(a.imageUrl)}
                        alt={a.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 left-3 flex gap-2">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-violet-600 text-white shadow-sm">
                          {a.category}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-900/80 text-white backdrop-blur-sm">
                          {a.branch}
                        </span>
                      </div>
                      <div className="absolute top-3 right-3">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm ${
                          a.isPublished ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                        }`}>
                          {a.isPublished ? 'Published' : 'Draft'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex gap-2">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-violet-100 text-violet-700 border border-violet-200">
                          {a.category}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          {a.branch}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider ${
                        a.isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {a.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  )}

                  {/* Body Content */}
                  <div className="p-5 space-y-3">
                    <h3 className="font-extrabold text-slate-900 text-base leading-snug line-clamp-2">{a.title}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{a.description}</p>

                    {a.participantName && (
                      <div className="flex items-center gap-1.5 text-xs text-violet-700 font-bold pt-1">
                        <span className="material-symbols-outlined text-[16px]">person</span>
                        <span>{a.participantName}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Metadata & Actions */}
                <div className="p-4 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
                  <div>
                    <p className="font-bold text-slate-700">{dateStr}</p>
                    <p className="text-[10px]">By {a.createdByName || 'Staff'}</p>
                  </div>

                  <div className="flex gap-1.5">
                    <button
                      onClick={() => togglePublishStatus(a)}
                      className={`p-2 rounded-xl text-xs font-bold transition-all ${
                        a.isPublished ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                      title={a.isPublished ? "Unpublish" : "Publish"}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {a.isPublished ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                    <button
                      onClick={() => openEditModal(a)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      title="Edit"
                    >
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button
                      onClick={() => setDeleteTarget(a)}
                      className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Branch Achievement"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Title *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={handleFieldChange('title')}
              placeholder="e.g. 1st Rank in Smart India Hackathon 2026"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Category</label>
              <select
                value={form.category}
                onChange={handleFieldChange('category')}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800 font-semibold"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Branch / Department
                <span className="ml-1 text-slate-400 font-normal normal-case">(auto-assigned)</span>
              </label>
              {isHod ? (
                <div className="relative">
                  <input
                    type="text"
                    disabled
                    value={form.branch || ''}
                    placeholder="Loading department..."
                    className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 cursor-not-allowed pr-10"
                  />
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">lock</span>
                </div>
              ) : (
                <select
                  value={form.branch}
                  onChange={handleFieldChange('branch')}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800 font-semibold"
                >
                  <option value="ALL">ALL (College Wide)</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
            </div>

          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Description *</label>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={handleFieldChange('description')}
              placeholder="Provide details about the achievement, project, award, or recognition..."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Participant / Winner Name</label>
              <input
                type="text"
                value={form.participantName}
                onChange={handleFieldChange('participantName')}
                placeholder="e.g. K. Sai Kumar (Student) / Dr. A. Sharma (Faculty)"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Achievement Date</label>
              <input
                type="date"
                value={form.achievementDate}
                onChange={handleFieldChange('achievementDate')}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Achievement Photo / Image</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
            />
            {imagePreview && (
              <div className="mt-2 h-32 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center">
                <img src={imagePreview} alt="Preview" className="h-full object-cover" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="isPublishedCreate"
              checked={form.isPublished}
              onChange={handleFieldChange('isPublished')}
              className="w-4 h-4 text-violet-600 rounded border-slate-300 focus:ring-violet-500"
            />
            <label htmlFor="isPublishedCreate" className="text-xs font-bold text-slate-800">
              Publish immediately (visible to students of target branch)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Achievement'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Achievement"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Title *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={handleFieldChange('title')}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Category</label>
              <select
                value={form.category}
                onChange={handleFieldChange('category')}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800 font-semibold"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Branch / Department</label>
              {isHod ? (
                <input
                  type="text"
                  disabled
                  value={form.branch}
                  className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 cursor-not-allowed"
                />
              ) : (
                <select
                  value={form.branch}
                  onChange={handleFieldChange('branch')}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800 font-semibold"
                >
                  <option value="ALL">ALL (College Wide)</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Description *</label>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={handleFieldChange('description')}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Participant Name</label>
              <input
                type="text"
                value={form.participantName}
                onChange={handleFieldChange('participantName')}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Achievement Date</label>
              <input
                type="date"
                value={form.achievementDate}
                onChange={handleFieldChange('achievementDate')}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 text-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Replace Image</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
            />
            {imagePreview && (
              <div className="mt-2 h-32 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center">
                <img src={imagePreview} alt="Preview" className="h-full object-cover" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="isPublishedEdit"
              checked={form.isPublished}
              onChange={handleFieldChange('isPublished')}
              className="w-4 h-4 text-violet-600 rounded border-slate-300 focus:ring-violet-500"
            />
            <label htmlFor="isPublishedEdit" className="text-xs font-bold text-slate-800">
              Published (visible to students)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              {saving ? 'Updating...' : 'Update Achievement'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Achievement?"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
