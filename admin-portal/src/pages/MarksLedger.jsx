import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import api from '../lib/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } } };

export default function MarksLedger() {
  const [analytics, setAnalytics] = useState(null);
  const [dashData, setDashData]   = useState(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [anlRes, dRes] = await Promise.all([
        api.get('/admin/analytics'),
        api.get('/admin/dashboard/stats')
      ]);
      setAnalytics(anlRes.data);
      setDashData(dRes.data);
    } catch(_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ac = analytics?.academics || {};
  const cgpaDist    = ac.cgpaDist || [];
  const branchCgpa  = ac.branchAvgCgpa || [];
  const semCgpa     = ac.semAvgCgpa || [];
  const gradeDist   = ac.gradeDistribution || [];
  const semToppers  = dashData?.academicPerformance || {};

  const cgpaBarData = {
    labels: cgpaDist.map(c => c.label),
    datasets: [{ data: cgpaDist.map(c => c.value),
      backgroundColor: ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444'],
      borderRadius: 8, barPercentage: 0.6 }]
  };
  const passDoughnut = {
    labels: ['Pass','Fail / Backlog'],
    datasets: [{ data: [ac.passPct||0, ac.failPct||0],
      backgroundColor: ['#10b981','#ef4444'], borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const branchBarData = {
    labels: branchCgpa.map(b => b.label),
    datasets: [{ data: branchCgpa.map(b => b.value),
      backgroundColor: '#6366f1', borderRadius: 6, barPercentage: 0.65 }]
  };
  const semLineData = {
    labels: semCgpa.map(s => s.label),
    datasets: [{ label: 'Avg CGPA', data: semCgpa.map(s => s.value),
      borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)',
      fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#6366f1' }]
  };
  const gradeBarData = {
    labels: gradeDist.slice(0,10).map(g => g.grade),
    datasets: [{ data: gradeDist.slice(0,10).map(g => g.count),
      backgroundColor: '#3b82f6', borderRadius: 5, barPercentage: 0.6 }]
  };
  const barOpts = { ...CHART_OPTS, scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
    y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 } } }
  }};

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Academic Marks Ledger</h2>
          <p className="text-xs text-gray-400 mt-0.5">CGPA, backlogs, and grade distribution analytics</p>
        </div>
        <button onClick={load} className="btn-icon"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-3">
        {[
          { label:'Avg CGPA',      value:(ac.avgCgpa||0).toFixed(2),           cls:'from-blue-600 to-indigo-700' },
          { label:'Pass %',        value:`${(ac.passPct||0).toFixed(1)}%`,     cls:'from-emerald-600 to-green-700' },
          { label:'Fail / Backlog',value:`${(ac.failPct||0).toFixed(1)}%`,     cls:'from-red-500 to-rose-600' },
          { label:'Total Backlogs',value:(ac.totalBacklogs||0).toLocaleString(),cls:'from-amber-500 to-orange-600' },
          { label:'Institution Topper',value:semToppers.topperCgpa ? `${semToppers.topperCgpa} CGPA` : '—', cls:'from-violet-600 to-purple-700' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl p-4 shadow-md bg-gradient-to-br ${k.cls} text-white`}>
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wide">{k.label}</p>
            <p className="text-xl font-black mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* 4 charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* CGPA Distribution */}
        <div className="chart-container">
          <h3 className="section-title mb-3">CGPA Distribution</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={cgpaBarData} options={barOpts} />}
          </div>
        </div>

        {/* Pass / Fail Doughnut */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Pass vs Fail / Backlog</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Doughnut data={passDoughnut} options={{...CHART_OPTS,cutout:'60%',
                plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:9}}}}}} />
            )}
          </div>
        </div>

        {/* Branch CGPA Bar */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Branch-wise Avg CGPA</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={branchBarData} options={barOpts} />}
          </div>
        </div>

        {/* Semester CGPA Line */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Semester-wise Avg CGPA</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Line data={semLineData} options={{...CHART_OPTS,
                plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}},
                scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{min:5,grid:{color:'#f3f4f6'},ticks:{font:{size:10}}}}}} />
            )}
          </div>
        </div>
      </div>

      {/* Grade distribution */}
      <div className="chart-container">
        <h3 className="section-title mb-4">Grade Distribution</h3>
        <div style={{height:200}}>
          {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={gradeBarData} options={barOpts} />}
        </div>
      </div>

      {/* Toppers summary */}
      {semToppers.topperName && (
        <div className="card p-5">
          <h3 className="section-title mb-4">Academic Highlights</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label:'Institution Topper', value: semToppers.topperName, sub: `CGPA: ${semToppers.topperCgpa}` },
              { label:'Lowest CGPA',        value: semToppers.lowestCgpa, sub: 'Needs academic support' },
              { label:'Average CGPA',       value: (ac.avgCgpa||0).toFixed(2), sub: 'All students' },
              { label:'Total Backlogs',     value: (ac.totalBacklogs||0).toLocaleString(), sub: 'Across all semesters' },
            ].map(item => (
              <div key={item.label} className="bg-gray-50 rounded-xl p-3 border">
                <p className="text-[10px] font-bold text-gray-400 uppercase">{item.label}</p>
                <p className="text-sm font-black text-gray-900 mt-1 truncate">{item.value}</p>
                <p className="text-[10px] text-gray-400">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
