import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function PlacementsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load placement analytics details.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const p = data?.placements || {
    totalDrives: 0,
    published: 0,
    highestPackage: '0 LPA',
    lowestPackage: '0 LPA',
    avgPackage: '0 LPA',
    studentsPlaced: 0,
    studentsNotPlaced: 0,
    placementPct: 0,
    departmentWise: [],
    topPackages: []
  };

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Placement Drives &amp; Salary Charts</h2>
          <p className="text-xs text-gray-400 mt-1">Corporate recruitment performance, CTC bands, and branch statistics</p>
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
          <StatCard title="Highest Package" value={p.highestPackage} icon="military_tech" color="yellow" />
          <StatCard title="Average CTC Package" value={p.avgPackage} icon="payments" color="blue" />
          <StatCard title="Placement rate" value={`${p.placementPct}%`} icon="percent" color="green" />
          <StatCard title="Total Offers Count" value={p.studentsPlaced} icon="work" color="indigo" />
        </section>
      )}

      {/* Main Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Side: Branch wise placement Comparison */}
        <div className="card p-5 xl:col-span-2 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-4">Department-wise Offer Progress</h3>
            <div className="space-y-4">
              {p.departmentWise?.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold text-gray-700">
                    <span>Department of {item.branch}</span>
                    <span className="font-bold">{item.placed ?? item.placedCount ?? 0} / {item.total ?? item.totalEligible ?? 0} placed ({item.pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(item.pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-5 grid grid-cols-2 gap-4 text-center">
            <div className="bg-gray-50 border rounded-xl p-3">
              <p className="text-[10px] uppercase font-bold text-gray-400">Total Placed Students</p>
              <p className="text-xl font-black text-emerald-600 mt-1">{p.studentsPlaced}</p>
            </div>
            <div className="bg-gray-50 border rounded-xl p-3">
              <p className="text-[10px] uppercase font-bold text-gray-400">Total Eligible Unplaced</p>
              <p className="text-xl font-black text-gray-400 mt-1">{p.studentsNotPlaced}</p>
            </div>
          </div>
        </div>

        {/* Right Side: Top Packages & Recruiters List */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3 text-indigo-600">Top Recruiters CTC Packages</h3>
          <div className="space-y-2">
            {p.topPackages?.length === 0 ? (
              <p className="text-center py-6 text-xs text-gray-400">No salary records registered yet.</p>
            ) : (
              p.topPackages?.map((item, i) => (
                <div key={i} className="flex justify-between items-center bg-gray-50 border rounded-lg p-2.5 text-xs">
                  <div>
                    <p className="font-bold text-gray-900">{item.company}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{item.role ?? item.jobTitle ?? item.jobRole ?? '—'}</p>
                  </div>
                  <Badge text={`${item.lpa ?? item.packageLpa ?? '0'} LPA`} color="indigo" />
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
