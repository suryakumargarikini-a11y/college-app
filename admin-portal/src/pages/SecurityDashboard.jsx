import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import { authStore } from '../store/authStore';

export default function SecurityDashboard() {
  const navigate = useNavigate();
  const [stats,   setStats]   = useState(null);
  const [exits,   setExits]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const currentUser = authStore.getUser();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/dashboard/security-stats')
      .then(res => {
        setStats(res.data.stats);
        setExits(res.data.recentActivity?.exits || []);
      })
      .catch(() => setError('Failed to load security stats.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm flex items-center gap-2">
      <span className="material-symbols-outlined text-[18px]">error</span>
      {error}
      <button onClick={load} className="ml-auto text-red-600 underline text-xs">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6 select-none fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Security Gate Operations</h2>
          <p className="text-sm text-gray-500 mt-1">Real-time gate verification and pass logs for Gate #1.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-3 py-1.5 text-xs font-semibold">
            {currentUser?.name || 'Gate Officer'}
          </span>
          <button onClick={load} className="btn-icon" title="Refresh">
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              {loading ? 'sync' : 'refresh'}
            </span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Exits Verified Today"
          value={stats?.exitsVerifiedToday ?? 0}
          icon="directions_walk"
          color="blue"
          subtitle="Gate exit passes"
          loading={loading && !stats}
        />
        <StatCard
          title="Active Approved Passes"
          value={stats?.approvedExitsCount ?? 0}
          icon="verified_user"
          color="green"
          subtitle="Awaiting verification"
          loading={loading && !stats}
        />
        <StatCard
          title="Total Passes Recorded"
          value={stats?.totalExitsCount ?? 0}
          icon="history"
          color="indigo"
          subtitle="All-time ledger"
          loading={loading && !stats}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">Recent Gate Activity</h3>
            <button onClick={() => navigate('/security/history')} className="btn-ghost text-xs text-blue-600">
              View Full History <span className="material-symbols-outlined text-[14px] align-middle">arrow_forward</span>
            </button>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="th">Student</th>
                    <th className="th">Roll</th>
                    <th className="th">Verification Time</th>
                    <th className="th text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !stats ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="skeleton w-7 h-7 rounded-full" /><div className="skeleton h-3 w-28 rounded" /></div></td>
                        <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
                        <td className="px-4 py-3"><div className="skeleton h-3 w-24 rounded" /></td>
                        <td className="px-4 py-3"><div className="skeleton h-5 w-14 rounded-full ml-auto" /></td>
                      </tr>
                    ))
                  ) : exits.length === 0 ? (
                    <tr><td colSpan="4" className="text-center py-12 text-sm text-gray-500">No gate activity logged yet today.</td></tr>
                  ) : (
                    exits.map(item => (
                      <tr key={item.id} className="tr-hover">
                        <td className="td">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-xs">
                              {item.student?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ST'}
                            </div>
                            <span className="text-sm font-medium text-gray-800">{item.student?.name}</span>
                          </div>
                        </td>
                        <td className="td text-xs font-mono text-gray-500">{item.student?.roll}</td>
                        <td className="td text-xs text-gray-500">
                          {item.verifiedAt
                            ? `${new Date(item.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${new Date(item.verifiedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                            : item.approvedAt ? `Approved: ${new Date(item.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'
                          }
                        </td>
                        <td className="td text-right">
                          <Badge value={item.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-800">Quick Actions</h3>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/security/verify-otp')}
              className="w-full p-5 bg-blue-600 text-white rounded-2xl flex items-center justify-between group hover:bg-blue-700 hover:shadow-lg transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-[30px]">pin</span>
                <div className="text-left">
                  <p className="font-bold text-sm leading-tight">Verify Student OTP</p>
                  <p className="text-[11px] text-white/75 mt-0.5">Manual Gate Entry Check</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-sm opacity-75 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">arrow_forward</span>
            </button>

            <button
              onClick={() => navigate('/security/history')}
              className="w-full p-5 bg-white border border-gray-200 rounded-2xl flex items-center justify-between group hover:border-blue-400 hover:shadow-sm transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-[30px] text-blue-600">history</span>
                <div className="text-left">
                  <p className="font-bold text-sm text-gray-800 leading-tight">Verification Logs</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Review Past Entries</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-sm text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
