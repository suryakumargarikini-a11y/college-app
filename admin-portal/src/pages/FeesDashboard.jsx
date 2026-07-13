import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } } };

export default function FeesDashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/admin/analytics'); setAnalytics(r.data); }
    catch(_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const fees = analytics?.fees || {};
  const monthly = fees.monthlyCollection || [];
  const status  = fees.statusBreakdown || {};
  const byType  = fees.byType || [];
  const branchW = fees.branchWise || [];

  const monthlyBarData = {
    labels: monthly.map(m => m.month),
    datasets: [
      { label: 'Collected', data: monthly.map(m => m.collected), backgroundColor: '#10b981', borderRadius: 6, barPercentage: 0.5 },
      { label: 'Pending',   data: monthly.map(m => m.pending),   backgroundColor: '#f59e0b', borderRadius: 6, barPercentage: 0.5 }
    ]
  };
  const monthlyOpts = { ...CHART_OPTS,
    plugins: { ...CHART_OPTS.plugins, legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
    scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 }, callback: v => `₹${(v/100000).toFixed(1)}L` } } }
  };

  const statusLabels = ['Paid','Partial','Unpaid'];
  const statusData = {
    labels: statusLabels,
    datasets: [{ data: statusLabels.map(k => (status[k.toLowerCase()]?.count || 0)),
      backgroundColor: ['#10b981','#f59e0b','#ef4444'],
      borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };

  const typeBarData = {
    labels: byType.map(t => t.type),
    datasets: [
      { label: 'Paid', data: byType.map(t => t.paid), backgroundColor: '#10b981', borderRadius: 5 },
      { label: 'Due',  data: byType.map(t => t.due),  backgroundColor: '#ef4444', borderRadius: 5 }
    ]
  };
  const typeOpts = { ...CHART_OPTS,
    plugins: { ...CHART_OPTS.plugins, legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
    scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 }, callback: v => `₹${(v/100000).toFixed(0)}L` } } }
  };

  const branchBarData = {
    labels: branchW.map(b => b.label),
    datasets: [
      { label: 'Collected', data: branchW.map(b => b.paid), backgroundColor: '#6366f1', borderRadius: 5 },
      { label: 'Pending',   data: branchW.map(b => b.due),  backgroundColor: '#f59e0b', borderRadius: 5 }
    ]
  };

  /* Gauge via ApexCharts */
  const collectionPct = fees.collectionPct || 0;

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Fee Collection Analytics</h2>
          <p className="text-xs text-gray-400 mt-0.5">Financial overview for all {analytics?.meta?.totalStudents || 500} students</p>
        </div>
        <button onClick={load} className="btn-icon"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue',   value: `₹${((fees.totalFees||0)/100000).toFixed(1)}L`,   cls: 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white' },
          { label: 'Collected',       value: `₹${((fees.totalPaid||0)/100000).toFixed(1)}L`,   cls: 'bg-gradient-to-br from-emerald-600 to-green-700 text-white' },
          { label: 'Pending',         value: `₹${((fees.totalDue||0)/100000).toFixed(1)}L`,    cls: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white' },
          { label: 'Collection Rate', value: `${collectionPct.toFixed(1)}%`,                   cls: 'bg-gradient-to-br from-violet-600 to-purple-700 text-white' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl p-4 shadow-md ${k.cls}`}>
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wide">{k.label}</p>
            <p className="text-2xl font-black mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Monthly Collection Bar */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Monthly Collection</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={monthlyBarData} options={monthlyOpts} />}
          </div>
        </div>

        {/* Status Doughnut */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Payment Status Breakdown</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Doughnut data={statusData} options={{...CHART_OPTS, cutout:'60%',
                plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:9}}}}}} />
            )}
          </div>
        </div>

        {/* Fee Type Breakdown */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Revenue by Fee Type</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={typeBarData} options={typeOpts} />}
          </div>
        </div>

        {/* Collection Gauge */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Collection Rate</h3>
          <div style={{height:220}}>
            {!loading && (
              <ReactApexChart type="radialBar" height={220}
                series={[collectionPct]}
                options={{
                  chart: { toolbar: { show: false } },
                  plotOptions: { radialBar: {
                    startAngle: -135, endAngle: 135,
                    track: { background: '#f3f4f6', strokeWidth: '97%' },
                    dataLabels: { name: { fontSize:'12px',color:'#6b7280' }, value: { fontSize:'22px',fontWeight:900,color:'#111827',formatter:v=>`${v.toFixed(1)}%` } },
                    hollow: { size: '65%' }
                  }},
                  colors: [collectionPct >= 90 ? '#10b981' : collectionPct >= 70 ? '#f59e0b' : '#ef4444'],
                  labels: ['Fee Collected'],
                  stroke: { dashArray: 4 }
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Branch-wise collection */}
      <div className="chart-container">
        <h3 className="section-title mb-4">Branch-wise Fee Collection</h3>
        <div style={{height:240}}>
          {loading ? <div className="skeleton h-full rounded-xl"/> : (
            <Bar data={branchBarData} options={{...CHART_OPTS,
              plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}},
              scales:{x:{grid:{display:false},ticks:{font:{size:10}}},
                y:{grid:{color:'#f3f4f6'},ticks:{font:{size:10},callback:v=>`₹${(v/100000).toFixed(0)}L`}}}}} />
          )}
        </div>
      </div>
    </div>
  );
}
