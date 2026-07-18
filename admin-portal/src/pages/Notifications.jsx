import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const INITIAL_FORM = { 
  title: '', 
  message: '', 
  targetAudience: 'ALL', 
  targetStudentRoll: '', 
  targetBranches: [], 
  targetYears: [], 
  targetSections: [], 
  priority: 'NORMAL',
  status: 'PUBLISHED',
  expiresAt: ''
};

const BRANCHES = ['CSE', 'ECE', 'MECH', 'CIVIL', 'IT'];
const YEARS = ['1', '2', '3', '4'];
const SECTIONS = ['A', 'B', 'C', 'D'];
const MSG_MAX = 200;

export default function Notifications() {
  const { toasts, showToast, removeToast } = useToast();
  const [form,           setForm]           = useState(INITIAL_FORM);
  const [sending,        setSending]        = useState(false);
  const [sendResult,     setSendResult]     = useState(null);
  const [history,        setHistory]        = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [editingId,      setEditingId]      = useState(null);

  const loadHistory = () => {
    setHistoryLoading(true);
    api.get('/admin/notifications')
      .then(r => setHistory(r.data))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  };
  useEffect(() => { loadHistory(); }, []);

  const handleSend = async (e) => {
    e.preventDefault(); setSending(true); setSendResult(null);
    try {
      const payload = {
        title: form.title,
        message: form.message,
        targetAudience: form.targetAudience,
        priority: form.priority,
        status: form.status,
        expiresAt: form.expiresAt || null
      };

      if (form.targetAudience === 'STUDENT') {
        payload.targetStudentRoll = form.targetStudentRoll;
      } else if (form.targetAudience === 'FILTERED') {
        payload.targetBranches = form.targetBranches;
        payload.targetYears = form.targetYears;
        payload.targetSections = form.targetSections;
      }

      if (editingId) {
        await api.put(`/admin/notifications/${editingId}`, payload);
        showToast('Notification updated successfully!');
      } else {
        await api.post('/admin/notifications', payload);
        showToast('Notification created successfully!');
      }

      setForm(INITIAL_FORM);
      setEditingId(null);
      loadHistory();
    } catch (err) {
      setSendResult({ success: false, message: err.response?.data?.error || 'Failed to save notification' });
      showToast('Failed to save notification', 'error');
    } finally { setSending(false); }
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
    try {
      if (item.targetBranches) branches = JSON.parse(item.targetBranches);
    } catch (_) {}
    try {
      if (item.targetYears) years = JSON.parse(item.targetYears);
    } catch (_) {}
    try {
      if (item.targetSections) sections = JSON.parse(item.targetSections);
    } catch (_) {}

    setForm({
      title: item.title,
      message: item.message,
      targetAudience: item.targetAudience,
      targetStudentRoll: item.targetStudent?.roll || '',
      targetBranches: branches,
      targetYears: years,
      targetSections: sections,
      priority: item.priority,
      status: item.status,
      expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 16) : ''
    });
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

  const toggleArrayItem = (key, value) => {
    setForm(p => {
      const arr = p[key];
      const next = arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value];
      return { ...p, [key]: next };
    });
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  const charsLeft = MSG_MAX - form.message.length;

  return (
    <div className="space-y-6 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader title="Notifications" subtitle="Send and manage notifications for students" />

      {/* Compose Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <span className="material-symbols-outlined text-blue-600 text-[18px]">{editingId ? 'edit_note' : 'send'}</span>
            </div>
            <h3 className="text-sm font-bold text-gray-900">{editingId ? 'Edit Notification' : 'Compose Notification'}</h3>
          </div>
          {editingId && (
            <button className="text-xs font-semibold text-gray-400 hover:text-gray-600 flex items-center gap-1" onClick={() => { setForm(INITIAL_FORM); setEditingId(null); }}>
              Cancel Edit
            </button>
          )}
        </div>

        {sendResult && (
          <div className={`mb-4 p-3 rounded-xl border text-sm flex items-center gap-2 bg-red-50 border-red-200 text-red-700`}>
            <span className="material-symbols-outlined text-[18px]">error</span>
            {sendResult.message}
          </div>
        )}

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Title *</label>
            <input className="input-field" value={form.title} onChange={f('title')} placeholder="Notification title" required />
          </div>

          <div>
            <div className="flex justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-600">Message *</label>
              <span className={`text-[11px] font-medium tabular-nums ${charsLeft < 20 ? 'text-red-500' : 'text-gray-400'}`}>{charsLeft} chars left</span>
            </div>
            <textarea
              className="input-field h-28 resize-none"
              value={form.message}
              onChange={f('message')}
              placeholder="Write your notification message…"
              maxLength={MSG_MAX}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Audience</label>
              <select className="input-field" value={form.targetAudience} onChange={f('targetAudience')}>
                <option value="ALL">All Students</option>
                <option value="STUDENT">Specific Student</option>
                <option value="FILTERED">Filtered Groups</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Priority</label>
              <select className="input-field" value={form.priority} onChange={f('priority')}>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Status</label>
              <select className="input-field" value={form.status} onChange={f('status')}>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Draft</option>
              </select>
            </div>
          </div>

          {/* Conditional Target UI */}
          {form.targetAudience === 'STUDENT' && (
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2 animate-reveal">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Student Roll Number / User ID *</label>
              <input 
                className="input-field bg-white" 
                value={form.targetStudentRoll} 
                onChange={f('targetStudentRoll')} 
                placeholder="E.g. 25A12216" 
                required={form.targetAudience === 'STUDENT'} 
              />
            </div>
          )}

          {form.targetAudience === 'FILTERED' && (
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-4 animate-reveal">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-600">Select Branches (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {BRANCHES.map(b => (
                    <button 
                      key={b} 
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${form.targetBranches.includes(b) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                      onClick={() => toggleArrayItem('targetBranches', b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-600">Select Academic Years (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {YEARS.map(y => (
                    <button 
                      key={y} 
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${form.targetYears.includes(y) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                      onClick={() => toggleArrayItem('targetYears', y)}
                    >
                      Year {y}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-600">Select Sections (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {SECTIONS.map(s => (
                    <button 
                      key={s} 
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${form.targetSections.includes(s) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                      onClick={() => toggleArrayItem('targetSections', s)}
                    >
                      Section {s}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-gray-400">Note: Leaving all options in a filter unselected will target all students in that criteria.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Optional Expiry Date</label>
            <input 
              type="datetime-local" 
              className="input-field font-mono" 
              value={form.expiresAt} 
              onChange={f('expiresAt')} 
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <span className="material-symbols-outlined text-[14px] text-gray-400">info</span>
              Targeting: 
              <span className="font-semibold text-gray-700 ml-0.5">
                {form.targetAudience === 'ALL' && 'All Students'}
                {form.targetAudience === 'STUDENT' && `Student ${form.targetStudentRoll || '...'}`}
                {form.targetAudience === 'FILTERED' && `Filtered Groups (${form.targetBranches.length} branches, ${form.targetYears.length} years, ${form.targetSections.length} sections)`}
              </span>
            </div>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">save</span>}
              {sending ? 'Saving…' : editingId ? 'Update Notification' : 'Send / Save Notification'}
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
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
                  } else if (item.targetAudience === 'FILTERED') {
                    let b = []; let y = [];
                    try { if (item.targetBranches) b = JSON.parse(item.targetBranches); } catch (_) {}
                    try { if (item.targetYears) y = JSON.parse(item.targetYears); } catch (_) {}
                    targetStr = `Filtered (${b.join(', ') || '*'} | Yr ${y.join(', ') || '*'})`;
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
