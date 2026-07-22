import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const INITIAL_FORM = { 
  title: '', 
  message: '', 
  targetAudience: 'ALL', // 'ALL' | 'TARGETED' | 'STUDENT'
  targetStudentRoll: '', 
  selectedBranch: '',
  selectedSemester: '',
  selectedSection: '',
  priority: 'NORMAL',
  status: 'PUBLISHED',
  expiresAt: ''
};

const MSG_MAX = 200;

export default function Notifications() {
  const { toasts, showToast, removeToast } = useToast();
  const [form,           setForm]           = useState(INITIAL_FORM);
  const [sending,        setSending]        = useState(false);
  const [sendResult,     setSendResult]     = useState(null);
  const [history,        setHistory]        = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [editingId,      setEditingId]      = useState(null);

  // Audience Metadata & Preview State
  const [audienceOptions, setAudienceOptions] = useState({ totalStudents: 0, branches: [] });
  const [optionsLoading,   setOptionsLoading]   = useState(true);
  const [recipientCount,   setRecipientCount]   = useState(0);
  const [pushCapableCount, setPushCapableCount] = useState(0);
  const [previewLoading,   setPreviewLoading]   = useState(false);

  // Specific Student Search State
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [selectedStudentObj, setSelectedStudentObj] = useState(null);

  // 1. Fetch Audience Options from DB on mount
  const loadAudienceOptions = async () => {
    setOptionsLoading(true);
    try {
      const res = await api.get('/admin/notifications/audience-options');
      if (res.data?.success) {
        setAudienceOptions({
          totalStudents: res.data.totalStudents || 0,
          branches: res.data.branches || []
        });
      }
    } catch (err) {
      showToast('Failed to load audience targeting options', 'error');
    } finally {
      setOptionsLoading(false);
    }
  };

  const loadHistory = () => {
    setHistoryLoading(true);
    api.get('/admin/notifications')
      .then(r => setHistory(r.data))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  };

  useEffect(() => { 
    loadAudienceOptions();
    loadHistory(); 
  }, []);

  // 2. Derive available Semesters based on selected Branch
  const availableSemesters = useMemo(() => {
    if (!form.selectedBranch) return [];
    const branchObj = audienceOptions.branches.find(b => b.value === form.selectedBranch);
    return branchObj ? branchObj.semesters : [];
  }, [form.selectedBranch, audienceOptions.branches]);

  // 3. Derive available Sections based on selected Branch & Semester
  const availableSections = useMemo(() => {
    if (!form.selectedBranch || !form.selectedSemester) return [];
    const semObj = availableSemesters.find(s => s.value === form.selectedSemester);
    return semObj ? semObj.sections : [];
  }, [form.selectedBranch, form.selectedSemester, availableSemesters]);

  // 4. Update Recipient Preview Count from Backend
  useEffect(() => {
    const updatePreview = async () => {
      if (form.targetAudience === 'ALL') {
        setRecipientCount(audienceOptions.totalStudents);
        setPushCapableCount(0);
        return;
      }

      if (form.targetAudience === 'STUDENT' && !form.targetStudentRoll) {
        setRecipientCount(0);
        setPushCapableCount(0);
        return;
      }

      setPreviewLoading(true);
      try {
        const payload = {
          targetAudience: form.targetAudience === 'TARGETED' ? 'FILTERED' : form.targetAudience,
          targetBranches: form.selectedBranch ? [form.selectedBranch] : [],
          targetYears: form.selectedSemester ? [form.selectedSemester] : [],
          targetSections: form.selectedSection ? [form.selectedSection] : [],
          targetStudentRoll: form.targetStudentRoll
        };

        const res = await api.post('/admin/notifications/audience-preview', payload);
        if (res.data?.success) {
          setRecipientCount(res.data.recipientCount || 0);
          setPushCapableCount(res.data.pushCapableCount || 0);
        }
      } catch (err) {
        // Fallback preview
      } finally {
        setPreviewLoading(false);
      }
    };

    updatePreview();
  }, [form.targetAudience, form.selectedBranch, form.selectedSemester, form.selectedSection, form.targetStudentRoll, audienceOptions.totalStudents]);

  // 5. Debounced Specific Student Search
  useEffect(() => {
    if (form.targetAudience !== 'STUDENT' || !studentSearchQuery || studentSearchQuery.length < 2) {
      setStudentSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingStudents(true);
      try {
        const res = await api.get(`/admin/notifications/search-students?q=${encodeURIComponent(studentSearchQuery)}`);
        setStudentSearchResults(res.data || []);
      } catch (_) {
        setStudentSearchResults([]);
      } finally {
        setIsSearchingStudents(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [studentSearchQuery, form.targetAudience]);

  // Handle Cascading Filter Resets
  const handleBranchChange = (e) => {
    const val = e.target.value;
    setForm(p => ({
      ...p,
      selectedBranch: val,
      selectedSemester: '', // Reset dependent semester
      selectedSection: ''   // Reset dependent section
    }));
  };

  const handleSemesterChange = (e) => {
    const val = e.target.value;
    setForm(p => ({
      ...p,
      selectedSemester: val,
      selectedSection: '' // Reset dependent section
    }));
  };

  const handleSend = async (e) => {
    e.preventDefault(); 
    setSending(true); 
    setSendResult(null);

    try {
      const payload = {
        title: form.title,
        message: form.message,
        targetAudience: form.targetAudience === 'TARGETED' ? 'FILTERED' : form.targetAudience,
        priority: form.priority,
        status: form.status,
        expiresAt: form.expiresAt || null
      };

      if (form.targetAudience === 'STUDENT') {
        payload.targetStudentRoll = form.targetStudentRoll;
      } else if (form.targetAudience === 'TARGETED') {
        payload.targetBranches = form.selectedBranch ? [form.selectedBranch] : [];
        payload.targetYears = form.selectedSemester ? [form.selectedSemester] : [];
        payload.targetSections = form.selectedSection ? [form.selectedSection] : [];
      }

      if (editingId) {
        await api.put(`/admin/notifications/${editingId}`, payload);
        showToast('Notification updated successfully!');
      } else {
        await api.post('/admin/notifications', payload);
        showToast('Notification created successfully!');
      }

      setForm(INITIAL_FORM);
      setSelectedStudentObj(null);
      setEditingId(null);
      loadHistory();
    } catch (err) {
      setSendResult({ success: false, message: err.response?.data?.error || 'Failed to save notification' });
      showToast('Failed to save notification', 'error');
    } finally { 
      setSending(false); 
    }
  };

  const handlePublish = async (id) => {
    try {
      await api.post(`/admin/notifications/${id}/publish`);
      showToast('Notification published successfully!');
      loadHistory();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to publish notification', 'error');
    }
  };

  const handleEdit = (item) => {
    let branches = [];
    let years = [];
    let sections = [];
    try { if (item.targetBranches) branches = JSON.parse(item.targetBranches); } catch (_) {}
    try { if (item.targetYears) years = JSON.parse(item.targetYears); } catch (_) {}
    try { if (item.targetSections) sections = JSON.parse(item.targetSections); } catch (_) {}

    const isTargeted = item.targetAudience === 'FILTERED' || item.targetAudience === 'TARGETED';

    setForm({
      title: item.title,
      message: item.message,
      targetAudience: isTargeted ? 'TARGETED' : item.targetAudience,
      targetStudentRoll: item.targetStudent?.roll || '',
      selectedBranch: branches[0] || '',
      selectedSemester: years[0] || '',
      selectedSection: sections[0] || '',
      priority: item.priority,
      status: item.status,
      expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 16) : ''
    });

    if (item.targetStudent) {
      setSelectedStudentObj(item.targetStudent);
    }

    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this notification?')) return;
    try {
      await api.delete(`/admin/notifications/${id}`);
      showToast('Notification deleted');
      if (editingId === id) {
        setForm(INITIAL_FORM);
        setEditingId(null);
      }
      loadHistory();
    } catch (err) {
      showToast('Failed to delete notification', 'error');
    }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  const charsLeft = MSG_MAX - form.message.length;

  return (
    <div className="space-y-6 fade-in max-w-5xl mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader title="Notifications" subtitle="Hierarchical audience targeting based on real student data" />

      {/* Compose Card */}
      <div className="card p-6 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-5 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <span className="material-symbols-outlined text-[20px]">{editingId ? 'edit_note' : 'send'}</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">{editingId ? 'Edit Notification' : 'Compose Notification'}</h3>
              <p className="text-[11px] text-gray-400">Target students dynamically by department, batch semester, or individual roll number.</p>
            </div>
          </div>
          {editingId && (
            <button className="text-xs font-semibold text-gray-400 hover:text-gray-600 flex items-center gap-1" onClick={() => { setForm(INITIAL_FORM); setSelectedStudentObj(null); setEditingId(null); }}>
              Cancel Edit
            </button>
          )}
        </div>

        {sendResult && (
          <div className="mb-4 p-3.5 rounded-xl border text-xs flex items-center gap-2 bg-red-50 border-red-200 text-red-700 font-medium">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {sendResult.message}
          </div>
        )}

        <form onSubmit={handleSend} className="space-y-5">
          {/* Notification Title */}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">Title *</label>
            <input className="input-field font-semibold" value={form.title} onChange={f('title')} placeholder="E.g. Mid-Term Examination Timetable Released" required />
          </div>

          {/* Message Body */}
          <div>
            <div className="flex justify-between mb-1.5">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Message *</label>
              <span className={`text-[11px] font-medium tabular-nums ${charsLeft < 20 ? 'text-red-500' : 'text-gray-400'}`}>{charsLeft} chars left</span>
            </div>
            <textarea
              className="input-field h-28 resize-none"
              value={form.message}
              onChange={f('message')}
              placeholder="Write circular notification message for students…"
              maxLength={MSG_MAX}
              required
            />
          </div>

          {/* Priority & Status Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">Priority</label>
              <select className="input-field bg-white" value={form.priority} onChange={f('priority')}>
                <option value="NORMAL">Normal Alert</option>
                <option value="HIGH">High Priority (Urgent)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">Publication Status</label>
              <select className="input-field bg-white" value={form.status} onChange={f('status')}>
                <option value="PUBLISHED">Publish Immediately</option>
                <option value="DRAFT">Save as Draft</option>
              </select>
            </div>
          </div>

          {/* ── HIERARCHICAL AUDIENCE SELECTION ── */}
          <div className="p-5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-4">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Send To
            </label>

            {/* Top-Level Target Category Radio Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                className={`p-3.5 rounded-xl border text-left flex items-center gap-3 transition-all ${form.targetAudience === 'ALL' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                onClick={() => setForm(p => ({ ...p, targetAudience: 'ALL' }))}
              >
                <span className="material-symbols-outlined text-[20px]">groups</span>
                <div>
                  <div className="text-xs font-bold">All Students</div>
                  <div className={`text-[10px] ${form.targetAudience === 'ALL' ? 'text-blue-100' : 'text-gray-400'}`}>Every active student</div>
                </div>
              </button>

              <button
                type="button"
                className={`p-3.5 rounded-xl border text-left flex items-center gap-3 transition-all ${form.targetAudience === 'TARGETED' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                onClick={() => setForm(p => ({ ...p, targetAudience: 'TARGETED' }))}
              >
                <span className="material-symbols-outlined text-[20px]">account_tree</span>
                <div>
                  <div className="text-xs font-bold">Target Students</div>
                  <div className={`text-[10px] ${form.targetAudience === 'TARGETED' ? 'text-blue-100' : 'text-gray-400'}`}>By branch & semester</div>
                </div>
              </button>

              <button
                type="button"
                className={`p-3.5 rounded-xl border text-left flex items-center gap-3 transition-all ${form.targetAudience === 'STUDENT' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                onClick={() => setForm(p => ({ ...p, targetAudience: 'STUDENT' }))}
              >
                <span className="material-symbols-outlined text-[20px]">person_search</span>
                <div>
                  <div className="text-xs font-bold">Specific Student</div>
                  <div className={`text-[10px] ${form.targetAudience === 'STUDENT' ? 'text-blue-100' : 'text-gray-400'}`}>Individual roll lookup</div>
                </div>
              </button>
            </div>

            {/* ── CASCADING TARGETING DROPDOWNS (TARGETED / FILTERED) ── */}
            {form.targetAudience === 'TARGETED' && (
              <div className="space-y-4 pt-2 border-t border-slate-200/60 animate-reveal">
                {optionsLoading ? (
                  <div className="text-xs text-gray-400 flex items-center gap-2 py-2">
                    <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                    Loading dynamic database branches…
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Branch Selector */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1.5">1. Branch / Department</label>
                      <select 
                        className="input-field bg-white text-xs font-semibold"
                        value={form.selectedBranch}
                        onChange={handleBranchChange}
                      >
                        <option value="">All Branches</option>
                        {audienceOptions.branches.map(b => (
                          <option key={b.value} value={b.value}>
                            {b.label} ({b.studentCount} students)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Semester Selector (Cascading) */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1.5">2. Academic Semester</label>
                      <select 
                        className="input-field bg-white text-xs font-semibold"
                        value={form.selectedSemester}
                        onChange={handleSemesterChange}
                        disabled={!form.selectedBranch}
                      >
                        <option value="">
                          {!form.selectedBranch ? 'Select Branch first' : 'All Semesters'}
                        </option>
                        {availableSemesters.map(s => (
                          <option key={s.value} value={s.value}>
                            {s.label} ({s.studentCount} students)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Section Selector (Cascading) */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1.5">3. Section (Optional)</label>
                      <select 
                        className="input-field bg-white text-xs font-semibold"
                        value={form.selectedSection}
                        onChange={f('selectedSection')}
                        disabled={!form.selectedSemester || availableSections.length === 0}
                      >
                        <option value="">
                          {!form.selectedSemester ? 'Select Semester first' : availableSections.length === 0 ? 'No Sections' : 'All Sections'}
                        </option>
                        {availableSections.map(sec => (
                          <option key={sec.value} value={sec.value}>
                            {sec.label} ({sec.studentCount} students)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── SEARCHABLE SPECIFIC STUDENT SELECTOR ── */}
            {form.targetAudience === 'STUDENT' && (
              <div className="space-y-3 pt-2 border-t border-slate-200/60 animate-reveal relative">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Search Student Name or Roll Number *
                </label>
                <div className="relative">
                  <input 
                    className="input-field bg-white pl-9"
                    value={studentSearchQuery}
                    onChange={(e) => setStudentSearchQuery(e.target.value)}
                    placeholder="Search by student name or roll number (e.g. 25B61A...)"
                  />
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">search</span>
                  {isSearchingStudents && (
                    <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin absolute right-3 top-3"></span>
                  )}
                </div>

                {/* Dropdown Search Results */}
                {studentSearchResults.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 top-[72px] bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {studentSearchResults.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full px-4 py-2.5 text-left hover:bg-blue-50 transition-colors flex items-center justify-between text-xs"
                        onClick={() => {
                          setForm(p => ({ ...p, targetStudentRoll: s.roll }));
                          setSelectedStudentObj(s);
                          setStudentSearchResults([]);
                          setStudentSearchQuery(`${s.name} (${s.roll})`);
                        }}
                      >
                        <div>
                          <div className="font-bold text-gray-900">{s.name}</div>
                          <div className="text-[10px] text-gray-400">{s.branch} · {s.semester}</div>
                        </div>
                        <span className="font-mono text-[11px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{s.roll}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected Student Confirmation Pill */}
                {selectedStudentObj && (
                  <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-blue-600 text-[18px]">check_circle</span>
                      <div>
                        <span className="font-bold text-blue-950">{selectedStudentObj.name}</span>
                        <span className="text-blue-700 ml-2 font-mono">({selectedStudentObj.roll})</span>
                      </div>
                    </div>
                    <button 
                      type="button"
                      className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
                      onClick={() => { setSelectedStudentObj(null); setForm(p => ({ ...p, targetStudentRoll: '' })); setStudentSearchQuery(''); }}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Expiry Date */}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">Optional Expiry Date</label>
            <input 
              type="datetime-local" 
              className="input-field font-mono bg-white" 
              value={form.expiresAt} 
              onChange={f('expiresAt')} 
            />
          </div>

          {/* Recipient Count Summary Footer */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-3 text-xs bg-slate-100 rounded-xl px-4 py-2.5 border border-slate-200/80">
              <span className="material-symbols-outlined text-[18px] text-blue-600">groups</span>
              <div>
                <span className="text-gray-500 font-medium">Recipients: </span>
                <span className="font-extrabold text-gray-900 ml-1">
                  {previewLoading ? (
                    <span className="inline-block w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    `${recipientCount.toLocaleString()} Students`
                  )}
                </span>
                {pushCapableCount > 0 && (
                  <span className="text-[10px] text-emerald-600 font-bold ml-2">({pushCapableCount} FCM push-ready)</span>
                )}
              </div>
            </div>

            <button type="submit" className="btn-primary py-2.5 px-6" disabled={sending}>
              {sending ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-[18px]">send</span>
              )}
              {sending ? 'Sending…' : editingId ? 'Update Notification' : `Send to ${recipientCount.toLocaleString()} Students`}
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <div className="card overflow-hidden shadow-sm border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900">Notification History</h3>
          <button onClick={loadHistory} className="btn-ghost text-xs">
            <span className="material-symbols-outlined text-[15px]">refresh</span>
            Refresh
          </button>
        </div>

        {historyLoading ? (
          <div className="p-5 space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton w-10 h-10 rounded-xl flex-shrink-0" />
                <div className="flex-1 space-y-2"><div className="skeleton h-3 w-48 rounded" /><div className="skeleton h-2.5 w-64 rounded" /></div>
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState icon="notifications_off" title="No notifications created yet" description="Compose your first draft or published notification above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">Title</th>
                  <th className="th">Message</th>
                  <th className="th">Target</th>
                  <th className="th">Status / Priority</th>
                  <th className="th">Expiry</th>
                  <th className="th">Sent At</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map(item => {
                  let targetStr = item.targetAudience;
                  if (item.targetAudience === 'STUDENT' && item.targetStudent) {
                    targetStr = `${item.targetStudent.name} (${item.targetStudent.roll})`;
                  } else if (item.targetAudience === 'FILTERED' || item.targetAudience === 'TARGETED') {
                    let b = []; let y = [];
                    try { if (item.targetBranches) b = JSON.parse(item.targetBranches); } catch (_) {}
                    try { if (item.targetYears) y = JSON.parse(item.targetYears); } catch (_) {}
                    targetStr = `${b.join(', ') || 'All Branches'} ${y.length ? `(${y.join(', ')})` : ''}`;
                  }
                  return (
                    <tr key={item.id} className="tr-hover">
                      <td className="td font-semibold text-gray-900">{item.title}</td>
                      <td className="td text-gray-500 max-w-[200px] truncate">{item.message}</td>
                      <td className="td text-xs text-gray-600 font-medium">{targetStr}</td>
                      <td className="td space-y-1">
                        <div className="flex gap-1">
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full border ${item.status === 'PUBLISHED' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                            {item.status}
                          </span>
                          <Badge value={item.priority} />
                        </div>
                      </td>
                      <td className="td text-xs text-gray-400 font-mono">
                        {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Never'}
                      </td>
                      <td className="td text-xs text-gray-400 whitespace-nowrap">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                      </td>
                      <td className="td">
                        <div className="flex items-center justify-end gap-2">
                          {item.status === 'DRAFT' && (
                            <button onClick={() => handlePublish(item.id)} className="text-[11px] font-bold px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors">
                              Publish
                            </button>
                          )}
                          <button onClick={() => handleEdit(item)} className="text-gray-400 hover:text-blue-600 p-1 flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600 p-1 flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
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
    </div>
  );
}
