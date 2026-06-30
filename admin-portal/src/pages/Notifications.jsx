import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const INITIAL_FORM = { title: '', message: '', targetAudience: 'ALL', priority: 'NORMAL' };

const TARGET_OPTIONS = [
  { value: 'ALL',      label: 'All Students' },
  { value: 'CSE',      label: 'CSE Branch' },
  { value: 'ECE',      label: 'ECE Branch' },
  { value: 'MECH',     label: 'Mechanical Branch' },
  { value: 'CIVIL',    label: 'Civil Branch' },
  { value: '1ST_YEAR', label: '1st Year' },
  { value: '2ND_YEAR', label: '2nd Year' },
  { value: '3RD_YEAR', label: '3rd Year' },
  { value: '4TH_YEAR', label: '4th Year' },
];

const MSG_MAX = 200;

export default function Notifications() {
  const { toasts, showToast, removeToast } = useToast();
  const [form,           setForm]           = useState(INITIAL_FORM);
  const [sending,        setSending]        = useState(false);
  const [sendResult,     setSendResult]     = useState(null);
  const [history,        setHistory]        = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = () => {
    setHistoryLoading(true);
    api.get('/admin/notifications/history')
      .then(r => setHistory(r.data))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  };
  useEffect(() => { loadHistory(); }, []);

  const handleSend = async (e) => {
    e.preventDefault(); setSending(true); setSendResult(null);
    try {
      const res = await api.post('/admin/notifications/send', form);
      setSendResult({ success: true, message: res.data?.message || 'Notification sent successfully!' });
      showToast('Notification sent!');
      setForm(INITIAL_FORM); loadHistory();
    } catch (err) {
      setSendResult({ success: false, message: err.response?.data?.error || 'Failed to send notification' });
      showToast('Failed to send notification', 'error');
    } finally { setSending(false); }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  const charsLeft = MSG_MAX - form.message.length;

  return (
    <div className="space-y-6 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <PageHeader title="Notifications" subtitle="Send push notifications to students" />

      {/* Compose Card */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-blue-600 text-[18px]">send</span>
          </div>
          <h3 className="text-sm font-bold text-gray-900">Compose Notification</h3>
        </div>

        {sendResult && (
          <div className={`mb-4 p-3 rounded-xl border text-sm flex items-center gap-2 ${sendResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <span className="material-symbols-outlined text-[18px]">{sendResult.success ? 'check_circle' : 'error'}</span>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Audience</label>
              <select className="input-field" value={form.targetAudience} onChange={f('targetAudience')}>
                {TARGET_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Priority</label>
              <select className="input-field" value={form.priority} onChange={f('priority')}>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <span className="material-symbols-outlined text-[14px] text-gray-400">info</span>
              Sending to: <span className="font-semibold text-gray-700 ml-0.5">{TARGET_OPTIONS.find(o => o.value === form.targetAudience)?.label}</span>
            </div>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">send</span>}
              {sending ? 'Sending…' : 'Send Notification'}
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
          <EmptyState icon="notifications_off" title="No notifications sent yet" description="Send your first notification using the compose form above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">Title</th><th className="th">Message</th><th className="th">Target</th>
                  <th className="th">Priority</th><th className="th">Sent At</th><th className="th">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(item => (
                  <tr key={item.id} className="tr-hover">
                    <td className="td font-semibold text-gray-900">{item.title}</td>
                    <td className="td text-gray-500 max-w-[200px] truncate">{item.message}</td>
                    <td className="td">
                      <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-100">
                        {TARGET_OPTIONS.find(o => o.value === item.targetAudience)?.label || item.targetAudience}
                      </span>
                    </td>
                    <td className="td"><Badge value={item.priority} /></td>
                    <td className="td text-xs text-gray-400 whitespace-nowrap">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                    </td>
                    <td className="td text-xs text-gray-500">{item.sentBy?.name || item.admin?.name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
