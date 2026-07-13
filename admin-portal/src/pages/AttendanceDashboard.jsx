import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function AttendanceDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load attendance metrics.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const att = data?.attendance || {
    overallAvg: 0,
    excellent: 0,
    good: 0,
    acceptable: 0,
    warning: 0,
    defaulters: 0,
    top20Defaulters: [],
    highestAttendance: [],
    lowestAttendance: [],
    branchComparison: []
  };

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Attendance Analytics</h2>
          <p className="text-xs text-gray-400 mt-1">Institutional attendance distributions and compliance tracking</p>
        </div>
        <button onClick={load} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </section>

      {/* Stats Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <StatCard key={i} loading />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Overall Attendance" value={`${att.overallAvg}%`} icon="event_available" color="blue" />
          <StatCard title="Excellent (≥90%)" value={att.excellent} icon="done_all" color="green" />
          <StatCard title="Warning (<75%)" value={att.warning + att.defaulters} icon="warning" color="yellow" />
          <StatCard title="Critical (<65%)" value={att.defaulters} icon="gavel" color="red" />
        </section>
      )}

      {/* Main Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Side: Defaulters and Averages */}
        <div className="card p-5 xl:col-span-2 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-4">Branch Attendance Averages</h3>
            <div className="space-y-4">
              {att.branchComparison?.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold text-gray-700">
                    <span>Department of {item.branch}</span>
                    <span className="font-bold">{item.avgPct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${item.avgPct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3 text-red-600">Top 20 Attendance Defaulters List (&lt;75%)</h3>
            <div className="overflow-x-auto border rounded-xl divide-y">
              {att.top20Defaulters?.length === 0 ? (
                <p className="text-center py-6 text-xs text-gray-400">No student is currently below the 75% attendance threshold.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50/50 font-bold uppercase text-[9px] text-gray-400 border-b">
                      <th className="p-2.5 pl-4">Name</th>
                      <th className="p-2.5">Roll Number</th>
                      <th className="p-2.5">Branch</th>
                      <th className="p-2.5">Sem</th>
                      <th className="p-2.5 text-right pr-4">Attendance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-gray-700 font-semibold">
                    {att.top20Defaulters?.map((stu, i) => (
                      <tr key={i} className="hover:bg-red-50/20">
                        <td className="p-2.5 pl-4 text-gray-900">{stu.name}</td>
                        <td className="p-2.5 text-gray-500 tabular-nums">{stu.roll}</td>
                        <td className="p-2.5">{stu.branch}</td>
                        <td className="p-2.5 tabular-nums">{stu.semester ?? '—'}</td>
                        <td className="p-2.5 text-right pr-4 text-red-600 font-extrabold tabular-nums">{stu.value ?? `${stu.avgPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Extremes (Highest and Lowest) */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3 text-emerald-600">Highest Attenders</h3>
            <div className="space-y-2">
              {Array.isArray(att.highestAttendance)
                ? att.highestAttendance.slice(0, 5).map((stu, i) => (
                  <div key={i} className="flex justify-between items-center bg-gray-50 border rounded-lg p-2 text-xs">
                    <div>
                      <p className="font-bold text-gray-900">{stu.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{stu.roll} – {stu.branch}</p>
                    </div>
                    <span className="font-extrabold text-emerald-600 tabular-nums">{stu.value ?? `${stu.avgPct}%`}</span>
                  </div>
                ))
                : att.highestAttendance && (
                  <div className="flex justify-between items-center bg-gray-50 border rounded-lg p-2 text-xs">
                    <div>
                      <p className="font-bold text-gray-900">{att.highestAttendance.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{att.highestAttendance.roll}</p>
                    </div>
                    <span className="font-extrabold text-emerald-600 tabular-nums">{att.highestAttendance.avgPct}%</span>
                  </div>
                )
              }
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3 text-red-500">Lowest Attenders</h3>
            <div className="space-y-2">
              {Array.isArray(att.lowestAttendance)
                ? att.lowestAttendance.slice(0, 5).map((stu, i) => (
                  <div key={i} className="flex justify-between items-center bg-gray-50 border rounded-lg p-2 text-xs">
                    <div>
                      <p className="font-bold text-gray-900">{stu.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{stu.roll} – {stu.branch}</p>
                    </div>
                    <span className="font-extrabold text-red-500 tabular-nums">{stu.value ?? `${stu.avgPct}%`}</span>
                  </div>
                ))
                : att.lowestAttendance && (
                  <div className="flex justify-between items-center bg-gray-50 border rounded-lg p-2 text-xs">
                    <div>
                      <p className="font-bold text-gray-900">{att.lowestAttendance.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{att.lowestAttendance.roll}</p>
                    </div>
                    <span className="font-extrabold text-red-500 tabular-nums">{att.lowestAttendance.avgPct}%</span>
                  </div>
                )
              }
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
