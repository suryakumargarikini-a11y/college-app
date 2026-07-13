import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } } };

export default function PlacementsDashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/admin/analytics'); setAnalytics(r.data); }
    catch(_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pl = analytics?.placements || {};
  const byBranch = pl.byBranch || [];
  const pkgCompany = pl.packageByCompany || [];
  const timeline = pl.timeline || [];

  const placedDoughnut = {
    labels: ['Placed','Not Placed'],
    datasets: [{ data: [pl.placed||0, pl.notPlaced||0],
      backgroundColor: ['#10b981','#f3f4f6'], borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const branchBarData = {
    labels: byBranch.map(b => b.label),
    datasets: [
      { label: 'Placed',     data: byBranch.map(b => b.placed), backgroundColor: '#10b981', borderRadius: 5 },
      { label: 'Not Placed', data: byBranch.map(b => b.total - b.placed), backgroundColor: '#f3f4f6', borderRadius: 5 }
    ]
  };
  const pkgBarData = {
    labels: pkgCompany.map(p => p.company.length > 12 ? p.company.slice(0,12)+'…' : p.company),
    datasets: [{ data: pkgCompany.map(p => p.lpa),
      backgroundColor: ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#f97316','#84cc16'],
      borderRadius: 6, barPercentage: 0.65 }]
  };
  const timelineData = {
    labels: timeline.map(t => t.month),
    datasets: [{ label: 'Offers', data: timeline.map(t => t.offers),
      borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)',
      fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#6366f1' }]
  };
  const barOpts = { ...CHART_OPTS,
    plugins: { ...CHART_OPTS.plugins, legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
    scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 } } } }
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Placements Analytics</h2>
          <p className="text-xs text-gray-400 mt-0.5">Campus recruitment insights for 2025–2026</p>
        </div>
        <button onClick={load} className="btn-icon"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label:'Students Placed', value:(pl.placed||0).toLocaleString(), cls:'bg-gradient-to-br from-emerald-600 to-green-700 text-white' },
          { label:'Placement %',     value:`${(pl.placementPct||0).toFixed(1)}%`,cls:'bg-gradient-to-br from-blue-600 to-indigo-700 text-white' },
          { label:'Highest Package', value:`₹${pl.highPkg||0} LPA`,  cls:'bg-gradient-to-br from-violet-600 to-purple-700 text-white' },
          { label:'Avg Package',     value:`₹${(pl.avgPkg||0).toFixed(2)} LPA`,cls:'bg-gradient-to-br from-amber-500 to-orange-600 text-white' },
          { label:'Total Drives',    value:(pl.totalDrives||0).toLocaleString(),  cls:'bg-gradient-to-br from-slate-600 to-gray-700 text-white' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl p-4 shadow-md ${k.cls}`}>
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wide">{k.label}</p>
            <p className="text-xl font-black mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Placed vs Not Placed Doughnut */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Placed vs Not Placed</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Doughnut data={placedDoughnut} options={{...CHART_OPTS,cutout:'60%',
                plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:9}}}}}} />
            )}
          </div>
        </div>

        {/* Department Placement Bar */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Department-wise Placements</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={branchBarData} options={barOpts} />}
          </div>
        </div>

        {/* Top Packages Bar */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Top Packages (LPA)</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Bar data={pkgBarData} options={{...CHART_OPTS,
                scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{grid:{color:'#f3f4f6'},ticks:{font:{size:10},callback:v=>`₹${v}L`}}}}} />
            )}
          </div>
        </div>

        {/* Placement Timeline Line */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Placement Timeline</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Line data={timelineData} options={{...CHART_OPTS,
                plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}},
                scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'#f3f4f6'},ticks:{font:{size:10}}}}}} />
            )}
          </div>
        </div>
      </div>

      {/* Placement % gauge */}
      <div className="chart-container flex flex-col items-center">
        <h3 className="section-title mb-4 self-start">Overall Placement Rate</h3>
        <ReactApexChart type="radialBar" height={220} series={[pl.placementPct||76]}
          options={{
            chart: { toolbar: { show: false } },
            plotOptions: { radialBar: {
              startAngle: -135, endAngle: 135,
              track: { background: '#f3f4f6', strokeWidth: '97%' },
              dataLabels: { name: { fontSize:'12px',color:'#6b7280' }, value: { fontSize:'28px',fontWeight:900,color:'#111827',formatter:v=>`${v}%` } },
              hollow: { size: '60%' }
            }},
            colors: ['#10b981'], labels: ['Placement Rate'], stroke: { dashArray: 4 }
          }}
        />
      </div>
    </div>
  );
}
