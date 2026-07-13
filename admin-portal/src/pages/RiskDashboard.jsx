import React, { useEffect, useState, useCallback } from 'react';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';

export default function RiskDashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [dashData, setDashData]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState(null);

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

  const risk  = analytics?.risk || {};
  const riskStudents = dashData?.riskStudents || {};
  const total = analytics?.meta?.totalStudents || 500;

  const RISK_CARDS = [
    { key:'attendance', icon:'event_busy',   label:'Attendance Risk',  count: risk.attendance||0,  color:'amber', threshold:'< 75%',  students: riskStudents.lowAttendance || [] },
    { key:'fee',        icon:'money_off',    label:'Fee Risk',         count: risk.fee||0,          color:'red',   threshold:'Has Due', students: riskStudents.feePending || [] },
    { key:'academic',   icon:'school',       label:'Academic Risk',    count: risk.academic||0,     color:'orange',threshold:'Backlog', students: riskStudents.backlogs || [] },
    { key:'placement',  icon:'work_off',     label:'Placement Risk',   count: risk.placement||0,    color:'violet',threshold:'Not Placed',students: riskStudents.lowCgpa || [] },
    { key:'multiRisk',  icon:'priority_high',label:'Multi-Risk',       count: risk.multiRisk||0,    color:'rose',  threshold:'2+ risks',students: [] },
  ];

  const colorMap = {
    amber:  { bg: 'bg-amber-50 border-amber-200',  icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700', bar: '#f59e0b' },
    red:    { bg: 'bg-red-50 border-red-200',       icon: 'text-red-600',   badge: 'bg-red-100 text-red-700',    bar: '#ef4444' },
    orange: { bg: 'bg-orange-50 border-orange-200', icon: 'text-orange-600',badge: 'bg-orange-100 text-orange-700', bar: '#f97316' },
    violet: { bg: 'bg-violet-50 border-violet-200', icon: 'text-violet-600',badge: 'bg-violet-100 text-violet-700', bar: '#8b5cf6' },
    rose:   { bg: 'bg-rose-50 border-rose-200',     icon: 'text-rose-600',  badge: 'bg-rose-100 text-rose-700',  bar: '#f43f5e' },
  };

  /* Risk category bar chart via ApexCharts */
  const riskSeries = [{ name: 'Students at Risk', data: RISK_CARDS.map(r => r.count) }];
  const riskOpts = {
    chart: { type: 'bar', toolbar: { show: false } },
    plotOptions: { bar: { borderRadius: 8, dataLabels: { position: 'top' } } },
    dataLabels: { enabled: true, offsetY: -18, style: { fontSize: '11px', fontWeight: 700, colors: ['#374151'] } },
    xaxis: { categories: RISK_CARDS.map(r => r.label), labels: { style: { fontSize: '10px' } } },
    yaxis: { labels: { style: { fontSize: '10px' } } },
    colors: RISK_CARDS.map(r => colorMap[r.color]?.bar),
    grid: { borderColor: '#f3f4f6' },
    tooltip: { y: { formatter: v => `${v} students` } }
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Risk Dashboard</h2>
          <p className="text-xs text-gray-400 mt-0.5">Early warning system — identifying students who need immediate intervention</p>
        </div>
        <button onClick={load} className="btn-icon"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </div>

      {/* Overall Risk Score */}
      {!loading && (
        <div className="card p-5 bg-gradient-to-r from-gray-900 to-slate-800 text-white">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase opacity-60 tracking-wide">Institution Risk Score</p>
              <p className="text-5xl font-black mt-1">
                {(100 - Math.round((risk.overallRiskPct || 0))).toFixed(0)}
                <span className="text-2xl font-normal opacity-60">/100</span>
              </p>
              <p className="text-xs mt-2 opacity-60">Higher is better — 100 = zero risk</p>
            </div>
            <div className="flex gap-4">
              {[
                { label: 'At Risk', value: risk.attendance + risk.fee + risk.academic, color: 'text-amber-400' },
                { label: 'Total Students', value: total, color: 'text-white' },
                { label: 'Risk %', value: `${(risk.overallRiskPct || 0).toFixed(1)}%`, color: 'text-red-400' },
              ].map(k => (
                <div key={k.label} className="text-center">
                  <p className={`text-2xl font-black ${k.color}`}>{typeof k.value === 'number' ? k.value.toLocaleString() : k.value}</p>
                  <p className="text-[10px] font-bold uppercase opacity-60 mt-1">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Risk Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {loading ? Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-32 rounded-2xl"/>) :
        RISK_CARDS.map(r => {
          const c = colorMap[r.color];
          const pct = Math.round((r.count / (total || 1)) * 100);
          return (
            <div key={r.key} onClick={() => setExpanded(expanded === r.key ? null : r.key)}
              className={`risk-card border rounded-2xl ${c.bg}`}>
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center ${c.icon}`}>
                  <span className="material-symbols-outlined text-[20px]">{r.icon}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${c.badge}`}>
                  {r.threshold}
                </span>
              </div>
              <p className="text-2xl font-black text-gray-900 mt-3">{r.count.toLocaleString()}</p>
              <p className="text-xs font-bold text-gray-500 mt-0.5">{r.label}</p>
              <div className="mt-3 h-1.5 bg-white rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100,pct)}%`, backgroundColor: colorMap[r.color]?.bar }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{pct}% of all students</p>
              {r.students.length > 0 && (
                <button className="mt-2 text-[11px] font-bold text-current underline">
                  {expanded === r.key ? 'Hide' : 'View'} students ↓
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded risk table */}
      {expanded && RISK_CARDS.find(r=>r.key===expanded)?.students.length > 0 && (
        <div className="card">
          <div className="p-4 border-b">
            <h3 className="section-title">{RISK_CARDS.find(r=>r.key===expanded)?.label} — Student List</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>{['Name','Roll No','Value'].map(h=><th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 uppercase">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(RISK_CARDS.find(r=>r.key===expanded)?.students || []).map((s,i)=>(
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{s.name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{s.roll}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded-full text-xs font-bold">{s.value}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Risk Bar Chart */}
      <div className="chart-container">
        <h3 className="section-title mb-4">Risk Count by Category</h3>
        {!loading && (
          <ReactApexChart type="bar" height={260} series={riskSeries} options={riskOpts} />
        )}
      </div>
    </div>
  );
}
