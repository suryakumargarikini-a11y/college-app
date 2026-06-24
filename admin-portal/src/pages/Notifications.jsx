import React, { useEffect, useState } from 'react';
import api from '../lib/api';

const INITIAL_FORM = {
  title: '',
  message: '',
  targetAudience: 'ALL',
  priority: 'NORMAL',
};

const TARGET_OPTIONS = [
  { value: 'ALL', label: 'All Students' },
  { value: 'CSE', label: 'CSE Branch' },
  { value: 'ECE', label: 'ECE Branch' },
  { value: 'MECH', label: 'Mechanical Branch' },
  { value: 'CIVIL', label: 'Civil Branch' },
  { value: '1ST_YEAR', label: '1st Year' },
  { value: '2ND_YEAR', label: '2nd Year' },
  { value: '3RD_YEAR', label: '3rd Year' },
  { value: '4TH_YEAR', label: '4th Year' },
];

export default function Notifications() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const loadHistory = () => {
    setHistoryLoading(true);
    api.get('/admin/notifications/history')
      .then(r => setHistory(r.data))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  };

  useEffect(() => { loadHistory(); }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.post('/admin/notifications/send', form);
      setSendResult({ success: true, message: res.data?.message || 'Notification sent successfully!' });
      showToast('Notification sent!');
      setForm(INITIAL_FORM);
      loadHistory();
    } catch (err) {
      setSendResult({
        success: false,
        message: err.response?.data?.error || 'Failed to send notification',
      });
    } finally {
      setSending(false);
    }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* Send Notification */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-600" style={{ fontSize: '20px' }}>send</span>
          Send Notification
        </h2>

        {sendResult && (
          <div className={`mb-4 p-3 rounded-lg border text-sm ${
            sendResult.success
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                {sendResult.success ? 'check_circle' : 'error'}
              </span>
              {sendResult.message}
            </div>
          </div>
        )}

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              className="input-field"
              value={form.title}
              onChange={f('title')}
              placeholder="Notification title"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
            <textarea
              className="input-field h-28 resize-none"
              value={form.message}
              onChange={f('message')}
              placeholder="Write your notification message..."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
              <select className="input-field" value={form.targetAudience} onChange={f('targetAudience')}>
                {TARGET_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select className="input-field" value={form.priority} onChange={f('priority')}>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>info</span>
              Notification will be sent to{' '}
              <span className="font-medium text-gray-700">
                {TARGET_OPTIONS.find(o => o.value === form.targetAudience)?.label}
              </span>
              {' '}via push notification
            </div>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={sending}
            >
              {sending ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>send</span>
              )}
              {sending ? 'Sending...' : 'Send Notification'}
            </button>
          </div>
        </form>
      </div>

      {/* Notification History */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Notification History</h3>
          <button onClick={loadHistory} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
            Refresh
          </button>
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-10">
            <span className="material-symbols-outlined text-gray-300 text-5xl block">notifications_off</span>
            <p className="text-sm text-gray-500 mt-2">No notifications sent yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Message</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Target</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Priority</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Sent At</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Sent By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-600 truncate max-w-[200px]">{item.message}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
                        {TARGET_OPTIONS.find(o => o.value === item.targetAudience)?.label || item.targetAudience}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge-${item.priority?.toLowerCase()}`}>{item.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {item.sentBy?.name || item.admin?.name || '—'}
                    </td>
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
