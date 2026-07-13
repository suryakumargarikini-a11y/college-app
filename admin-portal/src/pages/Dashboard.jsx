import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import api from '../lib/api';
import { authStore } from '../store/authStore';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler);

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
};

function AnimatedNumber({ value, suffix = '', prefix = '' }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const target = parseFloat(value) || 0;
    const start  = 0;
    const dur    = 800;
    const begin  = performance.now();
    const step   = (now) => {
      const t = Math.min((now - begin) / dur, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setDisplay(Math.round(start + (target - start) * ease));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <>{prefix}{display.toLocaleString('en-IN')}{suffix}</>;
}

function KpiCard({ title, value, suffix = '', prefix = '', icon, gradient, change }) {
  return (
    <div className={`rounded-2xl p-4 text-white relative overflow-hidden shadow-md ${gradient}`}>
      <div className="absolute right-3 top-3 opacity-20">
        <span className="material-symbols-outlined text-5xl">{icon}</span>
      </div>
      <p className="text-xs font-semibold opacity-80 uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-black mt-1 tabular-nums leading-none">
        <AnimatedNumber value={parseFloat((value || '0').toString().replace(/[^\d.]/g, ''))}
          prefix={prefix} suffix={suffix} />
      </p>
      {change !== undefined && (
        <p className="text-[10px] mt-1.5 opacity-75">
          {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% vs last month
        </p>
      )}
    </div>
  );
}

function HealthBadge({ label, score, color }) {
  const cls = { green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200' }[color] || 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <div className={`flex flex-col items-center justify-center p-3 rounded-xl border ${cls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-xl font-black mt-1">{score}%</p>
      <div className="w-full bg-white/50 h-1 rounded-full mt-2">
        <div className="h-full rounded-full bg-current" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

const ROLE_NAMES = {
  SUPER_ADMIN: 'Super Admin', ACCOUNTS_ADMIN: 'Accounts Administrator', PLACEMENT_ADMIN: 'Placement Officer',
};
const LOG_ICON = {
  ADMIN_LOGIN:  { icon: 'login',       cls: 'text-blue-600 bg-blue-50'     },
  ADMIN_LOGOUT: { icon: 'logout',      cls: 'text-gray-500 bg-gray-50'     },
  ANNOUNCEMENT_CREATED: { icon: 'campaign', cls: 'text-green-600 bg-green-50' },
  PLACEMENT_PUBLISHED:  { icon: 'work',     cls: 'text-indigo-600 bg-indigo-50' },
  FEE_PAYMENT_RECEIVED: { icon: 'payments', cls: 'text-emerald-600 bg-emerald-50' },
  ATTENDANCE_UPDATED:   { icon: 'edit_calendar', cls: 'text-sky-600 bg-sky-50' },
  MARKS_UPLOADED:       { icon: 'grading',   cls: 'text-amber-600 bg-amber-50' },
  EXIT_PASS_APPROVED:   { icon: 'check_circle', cls: 'text-emerald-600 bg-emerald-50' },
  EXIT_PASS_REJECTED:   { icon: 'cancel',    cls: 'text-red-600 bg-red-50'   },
  NOTIFICATION_SENT:    { icon: 'notifications', cls: 'text-blue-600 bg-blue-50' },
};

/* ── CHART PALETTE ────────────────────────────────────────────────────────── */
const BRANCH_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#6366f1','#ec4899'];

export default function Dashboard() {
  const navigate  = useNavigate();
  const user      = authStore.getUser();
  const userRole  = user?.role || 'SUPER_ADMIN';

  const [data, setData]         = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [riskTab, setRiskTab]   = useState('lowAttendance');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, anlRes] = await Promise.all([
        api.get('/admin/dashboard/stats'),
        api.get('/admin/analytics')
      ]);
      setData(statsRes.data);
      setAnalytics(anlRes.data);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const kpi  = data?.kpi || {};
  const fees = data?.fees || {};
  const risk = data?.riskStudents || {};
  const logs = data?.recentActivity?.auditLogs || [];
  const health = analytics?.health || {};
  const today  = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  /* ── Chart datasets ───────────────────────────────────────────────────── */
  const branchDist = analytics?.studentDistribution?.byBranch || [];
  const cgpaDist   = analytics?.academics?.cgpaDist || [];
  const attBands   = analytics?.attendance?.bandDist || [];
  const monthlyFees = analytics?.fees?.monthlyCollection || [];

  const doughnutData = {
    labels: branchDist.map(b => b.label),
    datasets: [{ data: branchDist.map(b => b.value), backgroundColor: BRANCH_COLORS,
      borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
  };
  const cgpaBarData = {
    labels: cgpaDist.map(c => c.label),
    datasets: [{ data: cgpaDist.map(c => c.value),
      backgroundColor: ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444'],
      borderRadius: 8, barPercentage: 0.6 }]
  };
  const attBarData = {
    labels: attBands.map(a => a.label),
    datasets: [{ data: attBands.map(a => a.value),
      backgroundColor: attBands.map(a => a.color), borderRadius: 8, barPercentage: 0.65 }]
  };
  const feeLineData = {
    labels: monthlyFees.map(m => m.month),
    datasets: [
      { label: 'Collected', data: monthlyFees.map(m => m.collected),
        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true,
        tension: 0.4, pointRadius: 4 },
      { label: 'Pending',   data: monthlyFees.map(m => m.pending),
        borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', fill: true,
        tension: 0.4, pointRadius: 4 }
    ]
  };
  const feeLineOpts = {
    ...CHART_OPTS,
    plugins: { ...CHART_OPTS.plugins, legend: { display: true, position: 'top',
      labels: { boxWidth: 10, font: { size: 10 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 10 },
        callback: v => `₹${(v/100000).toFixed(1)}L` } }
    }
  };
  const barOpts = {
    ...CHART_OPTS,
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 10 } } }
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <section className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-black text-gray-900 leading-tight">
            Welcome back, {user?.name?.split(' ')[0] || 'Administrator'} 👋
          </h2>
          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
            <span className="live-dot" />
            <span>Live · {today}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 no-print">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg border border-blue-100">
            {ROLE_NAMES[userRole] || userRole}
          </span>
          <button onClick={() => navigate('/analytics')} className="btn-secondary text-xs px-3 py-1.5">
            <span className="material-symbols-outlined text-[15px]">insights</span> Full Analytics
          </button>
          <button onClick={load} className="btn-icon" title="Refresh">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </section>

      {/* ── Institution Health Scores ──────────────────────────────────────── */}
      {!loading && analytics && (
        <section className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          <HealthBadge label="Overall Health"   score={health.overall    || 88} color="green"  />
          <HealthBadge label="Academic"          score={health.academic   || 85} color="blue"   />
          <HealthBadge label="Financial"         score={health.financial  || 87} color="yellow" />
          <HealthBadge label="Attendance"        score={health.attendance || 88} color="green"  />
          <HealthBadge label="Placement"         score={health.placement  || 76} color="indigo" />
          <HealthBadge label="Faculty"           score={health.faculty    || 88} color="blue"   />
          <HealthBadge label="LMS"               score={health.lms       || 72} color="indigo" />
        </section>
      )}

      {/* ── 12 KPI Cards ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {Array.from({length:12}).map((_,i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <KpiCard title="Total Students"    value={kpi.totalStudents}     icon="groups"                gradient="bg-gradient-to-br from-blue-600 to-blue-700"    change={2.3}  />
          <KpiCard title="Total Faculty"     value={kpi.totalFaculty || 20} icon="school"              gradient="bg-gradient-to-br from-emerald-600 to-teal-700"   change={0}    />
          <KpiCard title="Departments"       value={analytics?.studentDistribution?.byBranch?.length || 7} icon="apartment" gradient="bg-gradient-to-br from-violet-600 to-purple-700" />
          <KpiCard title="Total Courses"     value={kpi.totalCourses || 40} icon="import_contacts"     gradient="bg-gradient-to-br from-indigo-600 to-indigo-700"  change={1}    />
          <KpiCard title="Avg Attendance"    value={kpi.avgAttendance}     icon="event_available" suffix="%" gradient="bg-gradient-to-br from-sky-600 to-cyan-700" change={-0.4} />
          <KpiCard title="Avg CGPA"          value={analytics?.academics?.avgCgpa || 7.4} icon="star" gradient="bg-gradient-to-br from-amber-500 to-yellow-600"    change={0.2}  />
          <KpiCard title="Fee Collection"    value={kpi.feeCollectionPct}  icon="payments"    suffix="%" gradient="bg-gradient-to-br from-green-600 to-emerald-700" change={1.8}  />
          <KpiCard title="Students with Due" value={analytics?.fees?.feeRiskCount || 0}    icon="receipt_long"  gradient="bg-gradient-to-br from-orange-500 to-red-600"    />
          <KpiCard title="Placement %"       value={analytics?.placements?.placementPct || 76} icon="work" suffix="%" gradient="bg-gradient-to-br from-indigo-600 to-blue-700" change={4} />
          <KpiCard title="Pending Passes"    value={kpi.pendingExitPasses} icon="exit_to_app"           gradient="bg-gradient-to-br from-rose-500 to-pink-600"     />
          <KpiCard title="Notifications"     value={kpi.totalNotifications}icon="notifications"         gradient="bg-gradient-to-br from-fuchsia-600 to-violet-700" change={12}   />
          <KpiCard title="Today's Classes"   value={data?.todaysOverview?.classesRunning || 18} icon="class" gradient="bg-gradient-to-br from-slate-600 to-gray-700" />
        </section>
      )}

      {/* ── 4 Charts Row ──────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Department Distribution */}
        <div className="chart-container">
          <div className="section-header">
            <div>
              <h3 className="section-title">Department Distribution</h3>
              <p className="text-[10px] text-gray-400">Students by branch</p>
            </div>
          </div>
          <div style={{ height: 200 }}>
            {analytics ? (
              <Doughnut data={doughnutData} options={{ ...CHART_OPTS, cutout: '65%' }} />
            ) : <div className="skeleton h-full rounded-xl" />}
          </div>
        </div>

        {/* CGPA Distribution */}
        <div className="chart-container">
          <div className="section-header">
            <div>
              <h3 className="section-title">CGPA Distribution</h3>
              <p className="text-[10px] text-gray-400">Academic performance tiers</p>
            </div>
          </div>
          <div style={{ height: 200 }}>
            {analytics ? (
              <Bar data={cgpaBarData} options={barOpts} />
            ) : <div className="skeleton h-full rounded-xl" />}
          </div>
        </div>

        {/* Attendance Bands */}
        <div className="chart-container">
          <div className="section-header">
            <div>
              <h3 className="section-title">Attendance Bands</h3>
              <p className="text-[10px] text-gray-400">Student attendance distribution</p>
            </div>
          </div>
          <div style={{ height: 200 }}>
            {analytics ? (
              <Bar data={attBarData} options={barOpts} />
            ) : <div className="skeleton h-full rounded-xl" />}
          </div>
        </div>

        {/* Fee Collection Trend */}
        <div className="chart-container">
          <div className="section-header">
            <div>
              <h3 className="section-title">Fee Collection Trend</h3>
              <p className="text-[10px] text-gray-400">Monthly collected vs pending</p>
            </div>
          </div>
          <div style={{ height: 200 }}>
            {analytics ? (
              <Line data={feeLineData} options={feeLineOpts} />
            ) : <div className="skeleton h-full rounded-xl" />}
          </div>
        </div>
      </section>

      {/* ── Risk + Quick Actions ───────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Risk Identification */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <h3 className="text-sm font-bold text-gray-900">Student Risk Identification</h3>
            <div className="flex gap-1 bg-gray-50 p-0.5 rounded-lg">
              {[
                { key: 'lowAttendance', label: 'Attendance' },
                { key: 'feePending',    label: 'Fee'        },
                { key: 'backlogs',      label: 'Backlogs'   },
                { key: 'lowCgpa',       label: 'CGPA'       }
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setRiskTab(key)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    riskTab === key ? 'bg-white shadow text-blue-600' : 'text-gray-500'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-8 rounded" />)}</div>
          ) : (
            <table className="w-full text-left">
              <thead><tr className="text-[10px] uppercase text-gray-400 border-b">
                <th className="pb-2">Name</th><th className="pb-2">Roll No</th><th className="pb-2 text-right">Metric</th>
              </tr></thead>
              <tbody>{(risk[riskTab] || []).map((s, i) => (
                <tr key={i} className="border-t hover:bg-gray-50/40">
                  <td className="py-2 text-sm font-semibold text-gray-800">{s.name}</td>
                  <td className="py-2 text-xs text-gray-500">{s.roll}</td>
                  <td className="py-2 text-sm text-right">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-600 border border-red-200">{s.value}</span>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <button onClick={() => navigate('/risk-dashboard')}
            className="mt-3 text-xs text-blue-600 hover:underline font-semibold">
            View full risk dashboard →
          </button>
        </div>

        {/* Quick Operations */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Quick Operations</h3>
          {[
            { icon: 'campaign',   label: 'New Announcement',  path: '/announcements',    color: 'text-green-600'  },
            { icon: 'work',       label: 'New Placement Drive',path: '/placements',       color: 'text-indigo-600' },
            { icon: 'groups',     label: 'Student Registry',   path: '/students',         color: 'text-blue-600'   },
            { icon: 'insights',   label: 'Executive Analytics',path: '/analytics',        color: 'text-violet-600' },
            { icon: 'warning',    label: 'Risk Dashboard',     path: '/risk-dashboard',   color: 'text-amber-600'  },
            { icon: 'timeline',   label: 'Activity Center',    path: '/activity-center',  color: 'text-pink-600'   },
            { icon: 'exit_to_app',label: `Exit Passes (${kpi.pendingExitPasses||0})`, path:'/exit-passes', color:'text-red-500' },
          ].map(op => (
            <button key={op.path} onClick={() => navigate(op.path)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 text-left transition-colors">
              <div className={`w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center ${op.color}`}>
                <span className="material-symbols-outlined text-[18px]">{op.icon}</span>
              </div>
              <span className="text-sm font-medium text-gray-700">{op.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Today's Overview ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Admissions Today',  value: data?.todaysOverview?.admissionsToday || 5,   icon: 'person_add',  color: 'blue'    },
          { label: "Today's Attendance",value: data?.todaysOverview?.attendanceToday || '—',  icon: 'event_note',  color: 'green'   },
          { label: 'Fee Payments',      value: data?.todaysOverview?.feePaymentsToday || '—', icon: 'payments',    color: 'emerald' },
          { label: 'Notifications',     value: data?.todaysOverview?.notificationsSent || 0,  icon: 'notifications',color:'violet'  },
          { label: 'Exit Requests',     value: data?.todaysOverview?.exitPassRequests || 0,   icon: 'exit_to_app', color: 'amber'   },
          { label: 'Classes Running',   value: data?.todaysOverview?.classesRunning || 18,    icon: 'class',       color: 'indigo'  },
        ].map((item, i) => (
          <div key={i} className="card p-3 flex flex-col gap-1.5">
            <span className="material-symbols-outlined text-[20px] text-gray-400">{item.icon}</span>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{item.label}</p>
            <p className="text-base font-black text-gray-900">{item.value}</p>
          </div>
        ))}
      </section>

      {/* ── Audit Log ─────────────────────────────────────────────────────── */}
      <section className="card">
        <div className="p-5 border-b flex justify-between items-center">
          <h3 className="text-sm font-bold">System Activity Log</h3>
          <div className="flex items-center gap-2">
            <span className="live-dot" />
            <span className="text-[10px] font-bold uppercase text-gray-400">Live Feed</span>
          </div>
        </div>
        <div className="p-5 space-y-3 max-h-80 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-4">No recent activity</p>
          ) : logs.slice(0, 20).map(log => {
            const cfg = LOG_ICON[log.action] || { icon: 'info', cls: 'text-blue-600 bg-blue-50' };
            return (
              <div key={log.id} className="flex gap-3 items-start hover:bg-gray-50/40 rounded-lg p-1.5 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.cls}`}>
                  <span className="material-symbols-outlined text-[15px]">{cfg.icon}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{log.details}</p>
                  <p className="text-[10px] text-gray-400">{new Date(log.timestamp).toLocaleString('en-IN')}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
