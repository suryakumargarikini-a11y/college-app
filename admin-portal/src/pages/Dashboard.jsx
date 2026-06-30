import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import api from '../lib/api';
import { authStore } from '../store/authStore';

const LOG_ICON = {
  ADMIN_LOGIN:          { icon: 'login',          cls: 'text-blue-600 bg-blue-50 border-blue-200' },
  ADMIN_LOGOUT:         { icon: 'logout',          cls: 'text-gray-500 bg-gray-50  border-gray-200' },
  PASSWORD_CHANGED:     { icon: 'lock_reset',      cls: 'text-violet-600 bg-violet-50 border-violet-200' },
  ROLE_UPDATED:         { icon: 'manage_accounts', cls: 'text-amber-600 bg-amber-50  border-amber-200' },
  ANNOUNCEMENT_CREATED: { icon: 'campaign',        cls: 'text-green-600 bg-green-50  border-green-200' },
  PLACEMENT_PUBLISHED:  { icon: 'work',            cls: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  FEE_NOTICE_CREATED:   { icon: 'receipt_long',    cls: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  OTP_VERIFIED:         { icon: 'verified_user',   cls: 'text-teal-600 bg-teal-50    border-teal-200' },
  EXIT_PASS_APPROVED:   { icon: 'check_circle',    cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
};

const SEVERITY_CLS = {
  SECURITY: 'bg-violet-50 text-violet-700 border-violet-200',
  CRITICAL: 'bg-red-50   text-red-700   border-red-200',
  WARNING:  'bg-amber-50 text-amber-700 border-amber-200',
  INFO:     'bg-gray-50  text-gray-600  border-gray-200',
};

const ROLE_NAMES = {
  SUPER_ADMIN:    'Super Admin',
  ACCOUNTS_ADMIN: 'Accounts Administrator',
  PLACEMENT_ADMIN:'Placement Officer',
};

function SkeletonGrid({ count = 5 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatCard key={i} loading />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats,   setStats]   = useState(null);
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const user     = authStore.getUser();
  const userRole = user?.role || 'SUPER_ADMIN';

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/dashboard/stats')
      .then(res => {
        setStats(res.data.stats);
        setLogs(res.data.recentActivity?.auditLogs || []);
      })
      .catch(() => setError('Failed to load dashboard data. Please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-7 fade-in">

      {/* ── Welcome Banner ── */}
      <section className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 leading-tight">
            Welcome back, {user?.name?.split(' ')[0] || 'Administrator'} 👋
          </h2>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-gray-400">calendar_today</span>
              <span>{today}</span>
            </div>
            <span className="h-3 w-px bg-gray-300 hidden sm:block" />
            <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-100 text-xs font-semibold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Portal Online
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg border border-blue-100">
            <span className="material-symbols-outlined text-[15px]">badge</span>
            {ROLE_NAMES[userRole] || userRole}
          </span>
          <button
            onClick={load}
            className="btn-icon"
            title="Refresh dashboard"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </section>

      {/* ── Stats Grid ── */}
      {loading && !stats ? (
        <SkeletonGrid />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
          <button onClick={load} className="ml-auto text-red-700 underline text-xs hover:no-underline">Retry</button>
        </div>
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {stats?.students       !== undefined && <StatCard title="Total Students"      value={stats.students}          icon="groups"       color="blue"    subtitle="Registered students" />}
          {stats?.announcements  !== undefined && <StatCard title="Announcements"       value={stats.announcements}     icon="campaign"     color="green"   subtitle="Drafts & published" />}
          {stats?.placements     !== undefined && <StatCard title="Placement Drives"    value={stats.placements}        icon="work"         color="indigo"  subtitle="Active drives" />}
          {stats?.feeNotices     !== undefined && <StatCard title="Fee Notices"         value={stats.feeNotices}        icon="payments"     color="yellow"  subtitle="Active notices" />}
          {stats?.pendingExitPasses !== undefined && <StatCard title="Pending Passes"   value={stats.pendingExitPasses} icon="exit_to_app"  color="red"     subtitle="Awaiting review" />}
        </section>
      )}

      {/* ── Quick Actions ── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {userRole !== 'ACCOUNTS_ADMIN' && (
            <button
              onClick={() => navigate('/announcements')}
              className="card-hover p-4 flex items-center gap-3 text-left group"
            >
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0 group-hover:bg-green-100 transition-colors">
                <span className="material-symbols-outlined text-green-600 text-[20px]">campaign</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">New Announcement</p>
                <p className="text-xs text-gray-400">Post an update</p>
              </div>
              <span className="material-symbols-outlined text-[18px] text-gray-300 group-hover:text-gray-500 ml-auto transition-colors">arrow_forward</span>
            </button>
          )}
          {(userRole === 'SUPER_ADMIN' || userRole === 'PLACEMENT_ADMIN') && (
            <button
              onClick={() => navigate('/placements')}
              className="card-hover p-4 flex items-center gap-3 text-left group"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                <span className="material-symbols-outlined text-indigo-600 text-[20px]">work</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Add Placement Drive</p>
                <p className="text-xs text-gray-400">Create a new hiring drive</p>
              </div>
              <span className="material-symbols-outlined text-[18px] text-gray-300 group-hover:text-gray-500 ml-auto transition-colors">arrow_forward</span>
            </button>
          )}
          {userRole === 'SUPER_ADMIN' && (
            <button
              onClick={() => navigate('/exit-passes')}
              className="card-hover p-4 flex items-center gap-3 text-left group"
            >
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0 group-hover:bg-red-100 transition-colors">
                <span className="material-symbols-outlined text-red-500 text-[20px]">exit_to_app</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Review Exit Passes</p>
                <p className="text-xs text-gray-400">{stats?.pendingExitPasses ?? 0} pending</p>
              </div>
              <span className="material-symbols-outlined text-[18px] text-gray-300 group-hover:text-gray-500 ml-auto transition-colors">arrow_forward</span>
            </button>
          )}
        </div>
      </section>

      {/* ── System Log & Audit Trail ── */}
      <section className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-gray-900">System Log &amp; Audit Trail</h3>
            <p className="text-xs text-gray-400 mt-0.5">Recent administrative actions</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
          </span>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="skeleton w-9 h-9 rounded-xl flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3 w-3/4 rounded" />
                    <div className="skeleton h-2.5 w-1/2 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10">
              <span className="material-symbols-outlined text-4xl text-gray-300 block mb-2">assignment_late</span>
              <p className="text-sm text-gray-500 font-medium">No activity log entries yet</p>
            </div>
          ) : (
            <div className="space-y-5 relative before:absolute before:left-[17px] before:top-3 before:bottom-3 before:w-px before:bg-gray-100">
              {logs.map(log => {
                const cfg = LOG_ICON[log.action] || { icon: 'info', cls: 'text-blue-600 bg-blue-50 border-blue-200' };
                return (
                  <div key={log.id} className="relative pl-11 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    {/* Icon */}
                    <div className={`absolute left-0 top-0.5 w-9 h-9 rounded-xl border flex items-center justify-center z-10 ${cfg.cls}`}>
                      <span className="material-symbols-outlined text-[17px]">{cfg.icon}</span>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-snug">{log.details}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        By <span className="font-medium text-gray-600">{log.admin?.name || 'System'}</span>
                        {log.admin?.email ? ` (${log.admin.email})` : ''}
                      </p>
                    </div>
                    {/* Badges + time */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${SEVERITY_CLS[log.severity] || SEVERITY_CLS.INFO}`}>
                        {log.severity}
                      </span>
                      <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {new Date(log.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
