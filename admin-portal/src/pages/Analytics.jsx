import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler, RadialLinearScale } from 'chart.js';
import { Doughnut, Bar, Line, Radar } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, RadialLinearScale);

const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } } };

export default function Analytics() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [section, setSection]     = useState('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/admin/analytics'); setAnalytics(r.data); }
    catch(_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const exportPDF = () => window.print();
  const exportCSV = () => {
    const health = analytics?.health || {};
    const rows = [
      ['Metric','Value'],
      ['Overall Health', health.overall + '%'],
      ['Academic Health', health.academic + '%'],
      ['Financial Health', health.financial + '%'],
      ['Attendance Health', health.attendance + '%'],
      ['Placement Health', health.placement + '%'],
      ['Avg CGPA', analytics?.academics?.avgCgpa || '—'],
      ['Avg Attendance', analytics?.attendance?.overallAvg + '%'],
      ['Collection Rate', analytics?.fees?.collectionPct + '%'],
      ['Placement Rate', analytics?.placements?.placementPct + '%'],
      ['Total Students', analytics?.meta?.totalStudents],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `SITAM_Analytics_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  const health = analytics?.health || {};
  const ac     = analytics?.academics || {};
  const att    = analytics?.attendance || {};
  const fees   = analytics?.fees || {};
  const pl     = analytics?.placements || {};
  const risk   = analytics?.risk || {};
  const sd     = analytics?.studentDistribution || {};
  const lms    = analytics?.lms || {};

  /* Radar chart — institution health */
  const radarData = {
    labels: ['Academic', 'Financial', 'Attendance', 'Placement', 'Faculty', 'LMS'],
    datasets: [{ label: 'Health Score', fill: true,
      data: [health.academic||0, health.financial||0, health.attendance||0,
        health.placement||0, health.faculty||0, health.lms||0],
      borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.2)',
      pointBackgroundColor: '#6366f1', pointRadius: 4 }]
  };

  /* Student distribution donut */
  const genderData = {
    labels: (sd.byGender||[]).map(g=>g.label),
    datasets: [{ data: (sd.byGender||[]).map(g=>g.value),
      backgroundColor: ['#3b82f6','#ec4899','#8b5cf6'],
      borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const hostelData = {
    labels: (sd.byHostel||[]).map(g=>g.label),
    datasets: [{ data: (sd.byHostel||[]).map(g=>g.value),
      backgroundColor: ['#6366f1','#10b981'],
      borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const yearData = {
    labels: (sd.byYear||[]).map(g=>g.label),
    datasets: [{ data: (sd.byYear||[]).map(g=>g.value),
      backgroundColor: ['#3b82f6','#8b5cf6','#10b981','#f59e0b'],
      borderRadius: 6, barPercentage: 0.6 }]
  };

  /* Risk summary donut */
  const riskData = {
    labels: ['Attendance Risk','Fee Risk','Academic Risk','Placement Risk'],
    datasets: [{ data: [risk.attendance||0, risk.fee||0, risk.academic||0, risk.placement||0],
      backgroundColor: ['#f59e0b','#ef4444','#8b5cf6','#6366f1'],
      borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };

  const branchBarData = {
    labels: (sd.byBranch||[]).map(b=>b.label),
    datasets: [{ data: (sd.byBranch||[]).map(b=>b.value),
      backgroundColor: ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#6366f1','#ec4899'],
      borderRadius: 6, barPercentage: 0.65 }]
  };

  const SECS = ['overview','students','attendance','fees','placements','risk','lms'];

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Executive Analytics</h2>
          <p className="text-xs text-gray-400 mt-0.5">Comprehensive institutional performance report · Generated {new Date().toLocaleDateString('en-IN')}</p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={exportCSV} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">table_chart</span> Export CSV
          </button>
          <button onClick={exportPDF} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">print</span> Print / PDF
          </button>
          <button onClick={load} className="btn-icon" title="Refresh">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap no-print">
        {SECS.map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-3 py-1.5 text-xs font-semibold capitalize rounded-lg transition-colors ${
              section === s ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}>{s}</button>
        ))}
      </div>

      {/* Institution Health Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label:'Overall',    score: health.overall||0,    cls:'green'  },
          { label:'Academic',   score: health.academic||0,   cls:'blue'   },
          { label:'Financial',  score: health.financial||0,  cls:'yellow' },
          { label:'Attendance', score: health.attendance||0, cls:'green'  },
          { label:'Placement',  score: health.placement||0,  cls:'indigo' },
          { label:'Faculty',    score: health.faculty||0,    cls:'blue'   },
          { label:'LMS',        score: health.lms||0,        cls:'indigo' },
        ].map(h => {
          const clsMap = {
            green: 'from-emerald-50 to-green-100 border-emerald-200 text-emerald-700',
            blue:  'from-blue-50 to-indigo-100 border-blue-200 text-blue-700',
            yellow:'from-amber-50 to-yellow-100 border-amber-200 text-amber-700',
            indigo:'from-indigo-50 to-violet-100 border-indigo-200 text-indigo-700',
          }[h.cls];
          return (
            <div key={h.label} className={`rounded-xl p-3 border bg-gradient-to-br ${clsMap}`}>
              <p className="text-[9px] font-bold uppercase opacity-70 tracking-wide">{h.label}</p>
              <p className="text-2xl font-black mt-0.5">{h.score}%</p>
              <div className="mt-2 h-1 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full bg-current rounded-full transition-all" style={{width:`${h.score}%`}} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Overview section */}
      {(section === 'overview' || section === 'students') && (
        <section className="print-break">
          <h3 className="text-sm font-black text-gray-900 mb-4 border-b pb-2">Student Demographics</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="chart-container"><h4 className="text-xs font-bold mb-3">Gender Ratio</h4>
              <div style={{height:180}}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Doughnut data={genderData} options={{...CHART_OPTS,cutout:'60%',
                    plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:9}}}}}} />
                )}
              </div>
            </div>
            <div className="chart-container"><h4 className="text-xs font-bold mb-3">Hostel vs Day Scholar</h4>
              <div style={{height:180}}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Doughnut data={hostelData} options={{...CHART_OPTS,cutout:'60%',
                    plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:9}}}}}} />
                )}
              </div>
            </div>
            <div className="chart-container"><h4 className="text-xs font-bold mb-3">Year-wise Students</h4>
              <div style={{height:180}}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Bar data={yearData} options={{...CHART_OPTS,scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'#f3f4f6'},ticks:{font:{size:10}}}}}} />
                )}
              </div>
            </div>
            <div className="chart-container"><h4 className="text-xs font-bold mb-3">Department Distribution</h4>
              <div style={{height:180}}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Bar data={branchBarData} options={{...CHART_OPTS,scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'#f3f4f6'},ticks:{font:{size:10}}}}}} />
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Radar / Health Spider */}
      {(section === 'overview') && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="chart-container">
            <h3 className="text-xs font-bold mb-3">Institution Health Radar</h3>
            <div style={{height:280}}>
              {loading ? <div className="skeleton h-full rounded-xl"/> : (
                <Radar data={radarData} options={{...CHART_OPTS,
                  plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}},
                  scales:{r:{min:0,max:100,ticks:{stepSize:20,font:{size:9}},grid:{color:'#e5e7eb'},angleLines:{color:'#e5e7eb'}}}}} />
              )}
            </div>
          </div>
          <div className="chart-container">
            <h3 className="text-xs font-bold mb-3">Risk Distribution</h3>
            <div style={{height:280}}>
              {loading ? <div className="skeleton h-full rounded-xl"/> : (
                <Doughnut data={riskData} options={{...CHART_OPTS,cutout:'55%',
                  plugins:{...CHART_OPTS.plugins,legend:{display:true,position:'right',labels:{boxWidth:10,font:{size:10}}}}}} />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Summary table */}
      <section className="card print-break">
        <div className="p-5 border-b"><h3 className="section-title">Executive Summary Report</h3></div>
        <div className="p-5">
          <table className="w-full text-sm divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>{['Category','Metric','Value','Status'].map(h=>(
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                { cat:'Students',    metric:'Total Enrolled',       value: analytics?.meta?.totalStudents || 500,          status:'✅ On track' },
                { cat:'Academic',    metric:'Avg CGPA',             value: (ac.avgCgpa||0).toFixed(2),                    status: ac.avgCgpa >= 7 ? '✅ Excellent' : '⚠️ Needs attention' },
                { cat:'Academic',    metric:'Pass Rate',            value: `${(ac.passPct||0).toFixed(1)}%`,              status: ac.passPct >= 80 ? '✅ Good' : '⚠️ Needs attention' },
                { cat:'Academic',    metric:'Total Backlogs',       value: (ac.totalBacklogs||0).toLocaleString(),         status: ac.totalBacklogs < 100 ? '✅ Low' : '⚠️ High' },
                { cat:'Attendance',  metric:'Overall Average',      value: `${(att.overallAvg||0).toFixed(1)}%`,          status: att.overallAvg >= 80 ? '✅ Good' : '⚠️ Needs attention' },
                { cat:'Attendance',  metric:'Students at Risk',     value: risk.attendance || 0,                          status: risk.attendance < 50 ? '✅ Low' : '⚠️ High' },
                { cat:'Fees',        metric:'Collection Rate',      value: `${(fees.collectionPct||0).toFixed(1)}%`,      status: fees.collectionPct >= 85 ? '✅ Good' : '⚠️ Needs attention' },
                { cat:'Fees',        metric:'Total Revenue',        value: `₹${((fees.totalFees||0)/100000).toFixed(1)}L`,status:'—' },
                { cat:'Placements',  metric:'Placement Rate',       value: `${(pl.placementPct||0).toFixed(1)}%`,         status: pl.placementPct >= 70 ? '✅ Excellent' : '⚠️ Needs attention' },
                { cat:'Placements',  metric:'Avg Package',          value: `₹${(pl.avgPkg||0).toFixed(2)} LPA`,          status:'—' },
                { cat:'LMS',         metric:'Avg Course Progress',  value: `${(lms.avgProgress||0).toFixed(1)}%`,         status: lms.avgProgress >= 65 ? '✅ Good' : '⚠️ Needs attention' },
                { cat:'Risk',        metric:'Multi-Risk Students',  value: risk.multiRisk || 0,                           status: risk.multiRisk < 20 ? '✅ Low' : '⚠️ High' },
              ].map((row,i)=>(
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5"><span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{row.cat}</span></td>
                  <td className="px-4 py-2.5 text-sm text-gray-700">{row.metric}</td>
                  <td className="px-4 py-2.5 text-sm font-black text-gray-900">{row.value}</td>
                  <td className="px-4 py-2.5 text-xs">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
