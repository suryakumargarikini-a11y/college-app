import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';

const ACTION_ICONS = {
  ADMIN_LOGIN:          { icon: 'login',         cls: 'text-blue-600 bg-blue-50',     label: 'Admin Login'        },
  ADMIN_LOGOUT:         { icon: 'logout',         cls: 'text-gray-500 bg-gray-50',     label: 'Admin Logout'       },
  ANNOUNCEMENT_CREATED: { icon: 'campaign',       cls: 'text-green-600 bg-green-50',   label: 'Announcement'       },
  PLACEMENT_PUBLISHED:  { icon: 'work',           cls: 'text-indigo-600 bg-indigo-50', label: 'Placement Published'},
  FEE_NOTICE_CREATED:   { icon: 'receipt_long',   cls: 'text-emerald-600 bg-emerald-50',label:'Fee Notice'         },
  NOTIFICATION_SENT:    { icon: 'notifications',  cls: 'text-sky-600 bg-sky-50',       label: 'Notification'       },
  ATTENDANCE_UPDATED:   { icon: 'edit_calendar',  cls: 'text-cyan-600 bg-cyan-50',     label: 'Attendance Update'  },
  MARKS_UPLOADED:       { icon: 'grading',        cls: 'text-amber-600 bg-amber-50',   label: 'Marks Uploaded'     },
  EXIT_PASS_APPROVED:   { icon: 'check_circle',   cls: 'text-emerald-600 bg-emerald-50',label:'Exit Pass Approved' },
  EXIT_PASS_REJECTED:   { icon: 'cancel',         cls: 'text-red-600 bg-red-50',       label: 'Exit Pass Rejected' },
  PASSWORD_CHANGED:     { icon: 'lock_reset',     cls: 'text-violet-600 bg-violet-50', label: 'Password Changed'   },
  SURVEY_CREATED:       { icon: 'quiz',           cls: 'text-pink-600 bg-pink-50',     label: 'Survey Created'     },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

const TABS = ['All', 'Logins', 'Fee', 'Placement', 'Academic', 'Attendance', 'Notifications'];

const TAB_FILTERS = {
  All:           () => true,
  Logins:        l => l.action?.includes('LOGIN') || l.action?.includes('LOGOUT'),
  Fee:           l => l.action?.includes('FEE') || l.action?.includes('PAYMENT'),
  Placement:     l => l.action?.includes('PLACEMENT'),
  Academic:      l => l.action?.includes('MARKS') || l.action?.includes('ATTENDANCE'),
  Attendance:    l => l.action?.includes('ATTENDANCE'),
  Notifications: l => l.action?.includes('NOTIFICATION'),
};

export default function ActivityCenter() {
  const [logs, setLogs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState('All');
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/dashboard/stats');
      setLogs(r.data?.recentActivity?.auditLogs || []);
    } catch(_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => setRefresh(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const filtered = logs.filter(TAB_FILTERS[tab] || (() => true));
  const today    = filtered.filter(l => Date.now() - new Date(l.timestamp).getTime() < 86400000);
  const older    = filtered.filter(l => Date.now() - new Date(l.timestamp).getTime() >= 86400000);

  function renderLog(log) {
    const cfg = ACTION_ICONS[log.action] || { icon: 'info', cls: 'text-blue-600 bg-blue-50', label: log.action };
    return (
      <div key={log.id} className="flex gap-3 items-start p-3 rounded-xl hover:bg-gray-50 transition-colors">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.cls}`}>
          <span className="material-symbols-outlined text-[18px]">{cfg.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-800 leading-tight">{log.details || cfg.label}</p>
            <span className="text-[10px] text-gray-400 flex-shrink-0 font-mono">{timeAgo(log.timestamp)}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {log.admin && (
              <span className="text-[10px] text-gray-400">by {log.admin.name}</span>
            )}
            <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{cfg.label}</span>
          </div>
        </div>
      </div>
    );
  }

  /* Summary counts */
  const todayCount   = logs.filter(l => Date.now() - new Date(l.timestamp).getTime() < 86400000).length;
  const loginCount   = logs.filter(l => l.action?.includes('LOGIN')).length;
  const feeCount     = logs.filter(l => l.action?.includes('FEE')).length;
  const plCount      = logs.filter(l => l.action?.includes('PLACEMENT')).length;

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Activity Center</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="live-dot" />
            <span className="text-xs text-gray-400">Live feed — auto-refreshes every 30 seconds</span>
          </div>
        </div>
        <button onClick={load} className="btn-icon"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Today\'s Events',   value: todayCount,  icon: 'today',         cls: 'from-blue-50 to-indigo-100 text-blue-700 border-blue-200' },
          { label: 'Total Logs',        value: logs.length, icon: 'timeline',      cls: 'from-gray-50 to-slate-100 text-gray-700 border-gray-200' },
          { label: 'Admin Logins',      value: loginCount,  icon: 'login',         cls: 'from-emerald-50 to-green-100 text-emerald-700 border-emerald-200' },
          { label: 'Placement Events',  value: plCount,     icon: 'work',          cls: 'from-violet-50 to-purple-100 text-violet-700 border-violet-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl p-3 border bg-gradient-to-br ${k.cls}`}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">{k.icon}</span>
              <p className="text-[10px] font-bold uppercase">{k.label}</p>
            </div>
            <p className="text-2xl font-black mt-2">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              tab === t ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}>{t}</button>
        ))}
      </div>

      {/* Feed */}
      <div className="card">
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({length:8}).map((_,i)=><div key={i} className="skeleton h-12 rounded-xl"/>)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <span className="material-symbols-outlined text-4xl text-gray-300 block mb-2">history</span>
            <p className="text-sm text-gray-400">No activity found for this filter</p>
          </div>
        ) : (
          <div className="p-4">
            {today.length > 0 && (
              <>
                <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider px-3 mb-2">Today</p>
                {today.map(renderLog)}
              </>
            )}
            {older.length > 0 && (
              <>
                <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider px-3 mb-2 mt-4 border-t pt-4">Earlier</p>
                {older.slice(0, 40).map(renderLog)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
