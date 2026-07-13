import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function MarksLedger() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load academic marks details.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = data?.academicPerformance || {
    topperName: 'N/A',
    topperRoll: 'N/A',
    topperCgpa: '0.00',
    lowestCgpa: '0.00',
    avgCgpa: 0,
    totalBacklogs: 0,
    passPct: 0,
    failPct: 0
  };

  const cgpaBands = data?.cgpa || { above9: 0, "8to9": 0, "7to8": 0, "6to7": 0, below6: 0 };
  const riskStudents = data?.riskStudents || { lowAttendance: [], feePending: [], backlogs: [], lowCgpa: [] };

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Academic Marks Ledger</h2>
          <p className="text-xs text-gray-400 mt-1">Check grades, backlogs, toppers, and overall CGPA distributions</p>
        </div>
        <button onClick={load} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </section>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <StatCard key={i} loading />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Average CGPA" value={stats.avgCgpa} icon="star" color="blue" />
          <StatCard title="Institutional Pass Rate" value={`${stats.passPct}%`} icon="verified" color="green" />
          <StatCard title="Total Backlogs Count" value={stats.totalBacklogs} icon="gavel" color="red" />
          <StatCard title="College Topper CGPA" value={`${stats.topperCgpa} CGPA`} icon="emoji_events" color="yellow" />
        </section>
      )}

      {/* Main Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: CGPA distribution and backlogs */}
        <div className="card p-5 xl:col-span-2 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-4">CGPA Tier Distribution Bands</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Tier 1: Toppers (CGPA > 9.0)', val: cgpaBands.above9, color: 'bg-indigo-600' },
                { label: 'Tier 2: Excellent (CGPA 8.0 - 9.0)', val: cgpaBands["8to9"], color: 'bg-blue-500' },
                { label: 'Tier 3: Good (CGPA 7.0 - 8.0)', val: cgpaBands["7to8"], color: 'bg-emerald-500' },
                { label: 'Tier 4: Average (CGPA 6.0 - 7.0)', val: cgpaBands["6to7"], color: 'bg-yellow-500' },
                { label: 'Tier 5: Warning (CGPA < 6.0)', val: cgpaBands.below6, color: 'bg-red-500' }
              ].map((tier, idx) => (
                <div key={idx} className="border rounded-xl p-3 bg-gray-50/50 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-gray-400">{tier.label}</p>
                    <p className="text-lg font-extrabold mt-1 text-gray-800">{tier.val} <span className="text-xs font-normal text-gray-400">students</span></p>
                  </div>
                  <div className={`w-3.5 h-3.5 rounded-full ${tier.color}`} />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3 text-red-600">Students with Active Backlogs</h3>
            <div className="overflow-x-auto border rounded-xl divide-y">
              {riskStudents.backlogs?.length === 0 ? (
                <p className="text-center py-6 text-xs text-gray-400">Perfect academic ledger! Zero active backlog records.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50/50 font-bold uppercase text-[9px] text-gray-400 border-b">
                      <th className="p-2.5 pl-4">Name</th>
                      <th className="p-2.5">Roll Number</th>
                      <th className="p-2.5 text-right pr-4">Active Backlogs Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-gray-700 font-semibold">
                    {riskStudents.backlogs?.map((stu, i) => (
                      <tr key={i} className="hover:bg-red-50/10">
                        <td className="p-2.5 pl-4 text-gray-900">{stu.name}</td>
                        <td className="p-2.5 text-gray-500">{stu.roll}</td>
                        <td className="p-2.5 text-right pr-4 text-red-600 font-extrabold tabular-nums">{stu.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Semester Toppers */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3 text-red-500">Students with Low CGPA (&lt;6.5)</h3>
            <div className="space-y-2">
              {riskStudents.lowCgpa?.slice(0, 5).map((stu, i) => (
                <div key={i} className="flex justify-between items-center bg-gray-50 border rounded-lg p-2.5 text-xs">
                  <div>
                    <p className="font-bold text-gray-900">{stu.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{stu.roll}</p>
                  </div>
                  <Badge text={stu.value || 'Low CGPA'} color="red" />
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 bg-gradient-to-tr from-yellow-50 to-amber-100 border border-amber-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">military_tech</span> Top Performer
            </h3>
            <p className="text-lg font-black text-gray-900 leading-tight">{stats.topperName}</p>
            <p className="text-[10px] font-bold text-amber-700 mt-0.5">{stats.topperRoll}</p>
            <div className="mt-4 pt-4 border-t border-amber-200/50 flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase text-gray-500">CGPA Achieved</span>
              <span className="text-lg font-black text-amber-800 tabular-nums">{stats.topperCgpa}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
