import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } } };
const BAR_OPTS = { ...CHART_OPTS, indexAxis: 'y', scales: {
  x: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 } } },
  y: { grid: { display: false }, ticks: { font: { size: 10 } } }
}};

function KpiCard({ label, value, icon, cls }) {
  return (
    <div className={`card p-4 flex items-center gap-3 ${cls}`}>
      <div className="w-10 h-10 rounded-xl bg-current/10 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-black text-gray-900">{value}</p>
      </div>
    </div>
  );
}

export default function AttendanceDashboard() {
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

  const att = analytics?.attendance || {};
  const bands = att.bandDist || [];
  const byBranch = att.byBranch || [];
  const bySem    = att.bySemester || [];
  const trend    = att.trend || [];
  const defaulters = dashData?.attendance?.top20Defaulters || [];

  /* Chart data */
  const doughnutData = {
    labels: bands.map(b => b.label),
    datasets: [{ data: bands.map(b => b.value),
      backgroundColor: bands.map(b => b.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const branchBarData = {
    labels: byBranch.map(b => b.label),
    datasets: [{ data: byBranch.map(b => b.value),
      backgroundColor: ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#6366f1','#ec4899'],
      borderRadius: 6, barPercentage: 0.65 }]
  };
  const semBarData = {
    labels: bySem.map(b => b.label),
    datasets: [{ data: bySem.map(b => b.value),
      backgroundColor: '#6366f1', borderRadius: 8, barPercentage: 0.65 }]
  };
  const trendLineData = {
    labels: trend.map(t => t.month),
    datasets: [{ label: 'Avg Attendance%', data: trend.map(t => t.attendance),
      borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)',
      fill: true, tension: 0.4, pointRadius: 5 }]
  };
  const trendOpts = { ...CHART_OPTS,
    plugins: { ...CHART_OPTS.plugins, legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { min: 70, max: 100, grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 }, callback: v => `${v}%` } }
    }
  };

  /* Heatmap via ApexCharts */
  const heatmapSeries = ['Mon','Tue','Wed','Thu','Fri'].map(day => ({
    name: day,
    data: ['P1','P2','P3','P4','P5','P6'].map(p => ({
      x: p, y: Math.round(75 + Math.random() * 20)
    }))
  }));

  const overall = att.overallAvg || dashData?.attendance?.overallAvg || 0;
  const risk    = att.riskCount || 0;

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Attendance Analytics</h2>
          <p className="text-xs text-gray-400 mt-0.5">Institution-wide attendance insights from 500 students</p>
        </div>
        <button onClick={load} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Overall Avg" value={`${overall.toFixed(1)}%`} icon="event_available" cls="border-blue-100 bg-blue-50/30" />
        <KpiCard label="Excellent (≥90%)" value={bands.find(b=>b.label.includes('Excellent'))?.value||0} icon="workspace_premium" cls="border-emerald-100 bg-emerald-50/30" />
        <KpiCard label="At Risk (<75%)"   value={risk} icon="warning" cls="border-amber-100 bg-amber-50/30" />
        <KpiCard label="Critical (<65%)"  value={bands.find(b=>b.label.includes('Critical'))?.value||0} icon="error" cls="border-red-100 bg-red-50/30" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Attendance Distribution Doughnut */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Attendance Distribution</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Doughnut data={doughnutData} options={{...CHART_OPTS,cutout:'60%',plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:9}}}}}} />}
          </div>
        </div>

        {/* Branch comparison horizontal bar */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Attendance by Branch</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={branchBarData} options={BAR_OPTS} />}
          </div>
        </div>

        {/* Semester comparison bar */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Semester Comparison</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Bar data={semBarData} options={{...CHART_OPTS,
              scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{min:70,grid:{color:'#f3f4f6'},ticks:{font:{size:10},callback:v=>`${v}%`}}}}} />}
          </div>
        </div>

        {/* Monthly Trend Line */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Attendance Trend</h3>
          <div style={{height:220}}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : <Line data={trendLineData} options={trendOpts} />}
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="chart-container">
        <h3 className="section-title mb-3">Daily Attendance Heatmap (Period-wise)</h3>
        {!loading && (
          <ReactApexChart
            type="heatmap" height={180}
            series={heatmapSeries}
            options={{
              chart: { toolbar: { show: false } },
              dataLabels: { enabled: false },
              colors: ['#3b82f6'],
              xaxis: { type: 'category', labels: { style: { fontSize: '10px' } } },
              yaxis: { labels: { style: { fontSize: '10px' } } },
              plotOptions: { heatmap: { shadeIntensity: 0.5, radius: 4,
                colorScale: { ranges: [
                  { from: 0,  to: 65, name: 'Critical', color: '#ef4444' },
                  { from: 65, to: 75, name: 'Warning',  color: '#f59e0b' },
                  { from: 75, to: 90, name: 'Good',     color: '#3b82f6' },
                  { from: 90, to: 100,name: 'Excellent',color: '#10b981' },
                ]}
              }},
              tooltip: { y: { formatter: v => `${v}%` } }
            }}
          />
        )}
      </div>

      {/* Defaulters Table */}
      <div className="card">
        <div className="p-5 border-b">
          <h3 className="section-title">Top 20 Attendance Defaulters</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Students with lowest attendance percentages</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>{['#','Name','Roll No','Branch','Semester','Attendance'].map(h=><th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? Array.from({length:5}).map((_,i)=><tr key={i}><td colSpan={6}><div className="skeleton h-8 mx-4 my-1 rounded"/></td></tr>)
              : defaulters.map((s,i)=>(
                <tr key={i} className={`hover:bg-gray-50 ${s.avgPct < 65 ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-2.5 text-xs text-gray-400 font-bold">{i+1}</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{s.name}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{s.roll}</td>
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-bold">{s.branch}</span></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">Sem {s.semester}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.avgPct<65?'bg-red-500':s.avgPct<75?'bg-amber-500':'bg-blue-500'}`} style={{width:`${Math.min(100,s.avgPct)}%`}} />
                      </div>
                      <span className={`text-xs font-black ${s.avgPct<65?'text-red-600':s.avgPct<75?'text-amber-600':'text-blue-600'}`}>{s.avgPct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
