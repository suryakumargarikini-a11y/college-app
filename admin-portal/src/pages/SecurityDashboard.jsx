import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { authStore } from '../store/authStore';

export default function SecurityDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [exits, setExits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const currentUser = authStore.getUser();

  useEffect(() => {
    api.get('/admin/dashboard/security-stats')
      .then(res => {
        setStats(res.data.stats);
        setExits(res.data.recentActivity?.exits || []);
      })
      .catch(() => setError('Failed to load security stats.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm">{error}</div>
  );

  return (
    <div className="space-y-6 select-none">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Security Gate Operations</h2>
          <p className="text-sm text-gray-500 mt-1">Real-time gate verification and pass logs for Gate #1.</p>
        </div>
        <div className="bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-4 py-2 text-xs font-semibold">
          Active Guard: {currentUser?.name || 'Gate Officer'}
        </div>
      </div>

      {/* Stats Cards Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1 */}
        <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
          <div className="absolute top-4 right-4 text-gray-100 opacity-20 group-hover:opacity-40 transition-opacity">
            <span className="material-symbols-outlined text-[52px]">directions_walk</span>
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Exits Verified Today</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-900">{stats?.exitsVerifiedToday ?? 0}</span>
            <span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">Gate Exit Pass</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
          <div className="absolute top-4 right-4 text-gray-100 opacity-20 group-hover:opacity-40 transition-opacity">
            <span className="material-symbols-outlined text-[52px]">verified_user</span>
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active Approved Passes</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-blue-600">{stats?.approvedExitsCount ?? 0}</span>
            <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full font-semibold">Awaiting Verification</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
          <div className="absolute top-4 right-4 text-gray-100 opacity-20 group-hover:opacity-40 transition-opacity">
            <span className="material-symbols-outlined text-[52px]">history</span>
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Passes Recorded</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-900">{stats?.totalExitsCount ?? 0}</span>
            <span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">All-Time Ledger</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Logs + Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Recent Activity */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-gray-800">Recent Gate Activity</h3>
            <button
              onClick={() => navigate('/security/history')}
              className="text-blue-600 hover:text-blue-700 font-bold text-xs flex items-center gap-1 hover:underline"
            >
              View Full History <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-5 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Student Name</th>
                    <th className="px-5 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Roll Number</th>
                    <th className="px-5 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Verification Time</th>
                    <th className="px-5 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {exits.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="text-center py-12 text-sm text-gray-500">No gate activity logged yet today.</td>
                    </tr>
                  ) : (
                    exits.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-xs">
                              {item.student?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ST'}
                            </div>
                            <span className="text-sm font-medium text-gray-800">{item.student?.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-xs font-mono text-gray-500">{item.student?.roll}</td>
                        <td className="px-5 py-3.5 text-xs text-gray-500">
                          {item.verifiedAt ? (
                            <>
                              {new Date(item.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {new Date(item.verifiedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </>
                          ) : (
                            <>
                              Approved At: {new Date(item.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            item.status === 'USED' ? 'bg-gray-100 text-gray-600 border border-gray-200' :
                            item.status === 'APPROVED' ? 'bg-green-50 text-green-700 border border-green-200' :
                            'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Col: Quick Actions */}
        <div className="space-y-4">
          <h3 className="text-base font-bold text-gray-800">Quick Actions</h3>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/security/verify-otp')}
              className="w-full p-5 bg-blue-600 text-white rounded-2xl flex items-center justify-between group hover:bg-blue-700 hover:shadow-lg transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-[32px] text-white">pin</span>
                <div className="text-left">
                  <p className="font-bold text-sm leading-tight">Verify Student OTP</p>
                  <p className="text-[11px] text-white/80 mt-0.5">Manual Gate Entry Check</p>
                </div>
              </div>
              <span className="material-symbols-outlined opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-sm">arrow_forward</span>
            </button>

            <button
              onClick={() => navigate('/security/history')}
              className="w-full p-5 bg-white border border-gray-200 rounded-2xl flex items-center justify-between group hover:border-blue-500 hover:shadow-sm transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-[32px] text-blue-600">history</span>
                <div className="text-left">
                  <p className="font-bold text-sm text-gray-800 leading-tight">Verification Logs</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Review Past Entries</p>
                </div>
              </div>
              <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 text-blue-600 transition-opacity text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
