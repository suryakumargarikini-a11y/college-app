import React, { useEffect, useState } from 'react';
import StatCard from '../components/StatCard';
import api from '../lib/api';
import { authStore } from '../store/authStore';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  const currentUser = authStore.getUser();
  const userRole = currentUser?.role || 'SUPER_ADMIN';

  useEffect(() => {
    // Format date on load
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    setCurrentDate(new Date().toLocaleDateString(undefined, options));

    // Load statistics and activity feed
    api.get('/admin/dashboard/stats')
      .then(res => {
        setStats(res.data.stats);
        setLogs(res.data.recentActivity?.auditLogs || []);
      })
      .catch(() => setError('Failed to load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  const getRoleDisplayName = (role) => {
    switch (role) {
      case 'SUPER_ADMIN': return 'Super Admin';
      case 'ACCOUNTS_ADMIN': return 'Accounts Administrator';
      case 'PLACEMENT_ADMIN': return 'Placement Officer';
      default: return role;
    }
  };

  const getLogIconConfig = (action) => {
    switch (action) {
      case 'ADMIN_LOGIN': return { icon: 'login', colorClass: 'text-blue-600 bg-blue-50 border-blue-200' };
      case 'ADMIN_LOGOUT': return { icon: 'logout', colorClass: 'text-gray-500 bg-gray-50 border-gray-200' };
      case 'PASSWORD_CHANGED': return { icon: 'lock_reset', colorClass: 'text-purple-600 bg-purple-50 border-purple-200' };
      case 'ROLE_UPDATED': return { icon: 'manage_accounts', colorClass: 'text-amber-600 bg-amber-50 border-amber-200' };
      case 'ANNOUNCEMENT_CREATED': return { icon: 'campaign', colorClass: 'text-green-600 bg-green-50 border-green-200' };
      case 'PLACEMENT_PUBLISHED': return { icon: 'work', colorClass: 'text-indigo-600 bg-indigo-50 border-indigo-200' };
      case 'FEE_NOTICE_CREATED': return { icon: 'receipt_long', colorClass: 'text-yellow-600 bg-yellow-50 border-yellow-200' };
      case 'OTP_VERIFIED': return { icon: 'verified_user', colorClass: 'text-teal-600 bg-teal-50 border-teal-200' };
      case 'EXIT_PASS_APPROVED': return { icon: 'check_circle', colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
      default: return { icon: 'info', colorClass: 'text-blue-600 bg-blue-50 border-blue-200' };
    }
  };

  const getSeverityBadgeClass = (severity) => {
    switch (severity) {
      case 'SECURITY': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-200';
      case 'WARNING': return 'bg-amber-100 text-amber-800 border-amber-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm">{error}</div>
  );

  return (
    <div className="space-y-8 select-none">
      {/* Welcome Banner */}
      <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Welcome Back, {currentUser?.name || 'Administrator'}</h2>
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[18px]">calendar_today</span>
              <span>{currentDate}</span>
            </div>
            <span className="h-3 w-px bg-gray-300 hidden sm:block"></span>
            <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-100 text-xs">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="font-semibold uppercase tracking-wide text-[10px]">Portal Online</span>
            </div>
          </div>
        </div>
        
        {/* Quick info display */}
        <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-xl px-4 py-2 text-xs font-semibold">
          Active Session: {getRoleDisplayName(userRole)}
        </div>
      </section>

      {/* Dynamic Stats Cards Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {stats?.students !== undefined && (
          <StatCard title="Total Students" value={stats.students} icon="groups" color="blue" />
        )}
        {stats?.announcements !== undefined && (
          <StatCard title="Announcements" value={stats.announcements} icon="campaign" color="green" subtitle="Active drafts & published" />
        )}
        {stats?.placements !== undefined && (
          <StatCard title="Placement Drives" value={stats.placements} icon="work" color="indigo" subtitle="Hiring on campus" />
        )}
        {stats?.feeNotices !== undefined && (
          <StatCard title="Fee Notices" value={stats.feeNotices} icon="payments" color="yellow" subtitle="Active notifications" />
        )}
        {stats?.pendingExitPasses !== undefined && (
          <StatCard title="Pending Exit Passes" value={stats.pendingExitPasses} icon="exit_to_app" color="red" subtitle="Awaiting review" />
        )}
      </section>

      {/* Timeline System Logs (Activity Feed) */}
      <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-gray-900">System Log & Audit Trails</h3>
          <span className="text-xs font-mono text-gray-400">Security & Action Ledger</span>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/50">
            <span className="material-symbols-outlined text-[40px] text-gray-300 mb-2">assignment_late</span>
            <p className="text-sm text-gray-500 font-medium">No activity log entries found</p>
          </div>
        ) : (
          <div className="space-y-6 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
            {logs.map((log) => {
              const config = getLogIconConfig(log.action);
              return (
                <div key={log.id} className="relative pl-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 group">
                  {/* Icon */}
                  <div className={`absolute left-0 top-1 w-9 h-9 rounded-xl border flex items-center justify-center z-10 transition-all ${config.colorClass}`}>
                    <span className="material-symbols-outlined text-[18px]">{config.icon}</span>
                  </div>

                  {/* Content */}
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{log.details}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Executed by: <span className="font-medium text-gray-600">{log.admin?.name || 'System'}</span> ({log.admin?.email || 'automated'})
                    </p>
                  </div>

                  {/* Badges & Date */}
                  <div className="flex items-center gap-2 sm:text-right">
                    <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${getSeverityBadgeClass(log.severity)}`}>
                      {log.severity}
                    </span>
                    <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-lg">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {new Date(log.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
