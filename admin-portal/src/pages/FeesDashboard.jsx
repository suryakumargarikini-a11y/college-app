import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function FeesDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load financial fees analytics.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fees = data?.fees || {
    totalFees: 0,
    collected: 0,
    pending: 0,
    collectionPct: 0,
    statusBreakdown: [],
    monthlyCollection: []
  };

  const riskStudents = data?.riskStudents || { lowAttendance: [], feePending: [], backlogs: [], lowCgpa: [] };

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Fee Collection Analytics</h2>
          <p className="text-xs text-gray-400 mt-1">Real-time revenue demands, collections, and student balance tracking</p>
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
          <StatCard title="Total Fee Demand" value={`₹${(fees.totalFees / 10000000).toFixed(2)} Cr`} icon="payments" color="blue" />
          <StatCard title="Total Collected" value={`₹${(fees.collected / 10000000).toFixed(2)} Cr`} icon="check_circle" color="green" />
          <StatCard title="Pending Balance" value={`₹${(fees.pending / 100000).toFixed(1)} L`} icon="error" color="red" />
          <StatCard title="Collection Efficiency" value={`${fees.collectionPct}%`} icon="percent" color="yellow" />
        </section>
      )}

      {/* Main Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Collections timeline & Fee type breakdown */}
        <div className="card p-5 xl:col-span-2 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-4">Monthly Collection Ledger</h3>
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 font-bold uppercase text-[9px] text-gray-400 border-b">
                    <th className="p-3 pl-4">Month</th>
                    <th className="p-3 text-right">Transactions</th>
                    <th className="p-3 text-right pr-4">Collected Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-gray-700 font-semibold">
                  {fees.monthlyCollection?.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50/40">
                      <td className="p-3 pl-4 text-gray-900 font-bold">{item.month}</td>
                      <td className="p-3 text-right tabular-nums">{item.count ?? '—'} payments</td>
                      <td className="p-3 text-right text-emerald-600 font-bold tabular-nums pr-4">₹{(item.amount ?? 0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t pt-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Collection Status Breakdown</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              {fees.statusBreakdown && typeof fees.statusBreakdown === 'object' && !Array.isArray(fees.statusBreakdown)
                ? Object.entries(fees.statusBreakdown).map(([status, data], i) => (
                  <div key={i} className="bg-gray-50 border rounded-xl p-3">
                    <p className="text-[10px] uppercase font-bold text-gray-400 capitalize">{status} Payments</p>
                    <p className="text-lg font-black mt-1 text-gray-800">{data.count} <span className="text-xs font-normal text-gray-400">students</span></p>
                    <p className="text-xs text-gray-500 mt-0.5">₹{(data.amount ?? 0).toLocaleString('en-IN')}</p>
                  </div>
                ))
                : (fees.statusBreakdown || []).map((item, i) => (
                  <div key={i} className="bg-gray-50 border rounded-xl p-3">
                    <p className="text-[10px] uppercase font-bold text-gray-400">{item.status} Status</p>
                    <p className="text-lg font-black mt-1 text-gray-800">{item._count?.id ?? 0} <span className="text-xs font-normal text-gray-400">students</span></p>
                  </div>
                ))
              }
            </div>
          </div>
        </div>

        {/* Right: Outstanding Dues List */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3 text-red-600">Students with Pending Dues</h3>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {riskStudents.feePending?.length === 0 ? (
              <p className="text-center py-6 text-xs text-gray-400">Zero outstanding dues! All student accounts cleared.</p>
            ) : (
              riskStudents.feePending?.map((stu, i) => (
                <div key={i} className="flex justify-between items-center bg-gray-50 border rounded-lg p-2.5 text-xs">
                  <div>
                    <p className="font-bold text-gray-900">{stu.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{stu.roll}</p>
                  </div>
                  <span className="font-extrabold text-red-600 tabular-nums">{stu.value}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
