import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import api from '../lib/api';
import { authStore } from '../store/authStore';

const LOG_ICON = {
  ADMIN_LOGIN:          { icon: 'login',          cls: 'text-blue-600 bg-blue-50 border-blue-200' },
  ADMIN_LOGOUT:         { icon: 'logout',          cls: 'text-gray-500 bg-gray-50  border-gray-200' },
  PASSWORD_CHANGED:     { icon: 'lock_reset',      cls: 'text-violet-600 bg-violet-50 border-violet-200' },
  ROLE_UPDATED:         { icon: 'manage_accounts', cls: 'text-amber-600 bg-amber-50  border-amber-200' },
  ANNOUNCEMENT_CREATED: { icon: 'campaign',        cls: 'text-green-600 bg-green-50  border-green-200' },
  PLACEMENT_PUBLISHED:  { icon: 'work',            cls: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  FEE_NOTICE_CREATED:   { icon: 'receipt_long',    cls: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  OTP_VERIFIED:         { icon: 'verified_user',   cls: 'text-teal-600 bg-teal-50    border-teal-200' },
  EXIT_PASS_APPROVED:   { icon: 'check_circle',    cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  EXIT_PASS_REJECTED:   { icon: 'cancel',          cls: 'text-red-600 bg-red-50 border-red-200' },
  FEE_PAYMENT_RECEIVED: { icon: 'payments',        cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  ATTENDANCE_UPDATED:   { icon: 'edit_calendar',   cls: 'text-sky-600 bg-sky-50 border-sky-200' },
  MARKS_UPLOADED:       { icon: 'grading',         cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  NOTIFICATION_SENT:    { icon: 'notifications',   cls: 'text-blue-600 bg-blue-50 border-blue-200' },
  ASSIGNMENT_POSTED:    { icon: 'assignment',      cls: 'text-pink-600 bg-pink-50 border-pink-200' },
  QUIZ_PUBLISHED:       { icon: 'quiz',            cls: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  COURSE_ENROLLED:      { icon: 'school',          cls: 'text-violet-600 bg-violet-50 border-violet-200' },
  SURVEY_LAUNCHED:      { icon: 'poll',            cls: 'text-orange-600 bg-orange-50 border-orange-200' },
  TICKET_CREATED:       { icon: 'support_agent',   cls: 'text-red-600 bg-red-50 border-red-200' },
  TICKET_RESOLVED:      { icon: 'check',           cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  ACHIEVEMENT_RECORDED: { icon: 'emoji_events',    cls: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
};

const SEVERITY_CLS = {
  SECURITY: 'bg-violet-50 text-violet-700 border-violet-200',
  CRITICAL: 'bg-red-50   text-red-700   border-red-200',
  WARNING:  'bg-amber-50 text-amber-700 border-amber-200',
  INFO:     'bg-gray-50  text-gray-600  border-gray-200',
};

const ROLE_NAMES = {
  SUPER_ADMIN:    'Super Admin',
  ACCOUNTS_ADMIN: 'Accounts Administrator',
  PLACEMENT_ADMIN:'Placement Officer',
};

function SkeletonGrid({ count = 8 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatCard key={i} loading />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [riskTab, setRiskTab] = useState('lowAttendance');

  const user = authStore.getUser();
  const userRole = user?.role || 'SUPER_ADMIN';

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/dashboard/stats')
      .then(res => {
        setData(res.data);
      })
      .catch(() => setError('Failed to load dashboard data. Please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const kpi = data?.kpi || {};
  const todaysOverview = data?.todaysOverview || {};
  const riskStudents = data?.riskStudents || { lowAttendance: [], feePending: [], backlogs: [], lowCgpa: [] };
  const attendance = data?.attendance || { overallAvg: 0, branchComparison: [], excellent: 0, good: 0, acceptable: 0, warning: 0, defaulters: 0 };
  const fees = data?.fees || { totalFees: 0, collected: 0, pending: 0, collectionPct: 0, monthlyCollection: [] };
  const placements = data?.placements || { placementPct: 0, highestPackage: 'N/A', avgPackage: 'N/A', lowestPackage: 'N/A', departmentWise: [] };
  const cgpa = data?.cgpa || { above9: 0, "8to9": 0, "7to8": 0, "6to7": 0, below6: 0 };
  const departments = data?.departments || [];
  const logs = data?.recentActivity?.auditLogs || [];

  return (
    <div className="space-y-7 fade-in">

      <section className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 leading-tight">
            Welcome back, {user?.name?.split(' ')[0] || 'Administrator'} 👋
          </h2>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-gray-400">calendar_today</span>
              <span>{today}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg border border-blue-100">
            {ROLE_NAMES[userRole] || userRole}
          </span>
          <button onClick={load} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
        </div>
      </section>

      {loading && !data ? (
        <SkeletonGrid />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          {error} <button onClick={load} className="ml-auto underline">Retry</button>
        </div>
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Students" value={kpi.totalStudents} icon="groups" color="blue" />
          <StatCard title="Faculty Count" value={kpi.totalFaculty} icon="school" color="emerald" />
          <StatCard title="Total Courses" value={kpi.totalCourses} icon="import_contacts" color="indigo" />
          <StatCard title="Avg Attendance" value={`${kpi.avgAttendance}%`} icon="event_available" color="green" />
          <StatCard title="Fee Collection" value={`${kpi.feeCollectionPct}%`} icon="payments" color="yellow" />
          <StatCard title="Placement Drives" value={kpi.publishedPlacements} icon="work" color="violet" />
          <StatCard title="Pending Passes" value={kpi.pendingExitPasses} icon="exit_to_app" color="red" />
          <StatCard title="Notifications Sent" value={kpi.totalNotifications} icon="notifications" color="blue" />
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Today's Overview Snapshot</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-gray-50 border rounded-xl p-3">
              <p className="text-[10px] uppercase font-bold text-gray-400">Admissions</p>
              <p className="text-lg font-extrabold">{todaysOverview.admissionsToday ?? 0}</p>
            </div>
            <div className="bg-gray-50 border rounded-xl p-3">
              <p className="text-[10px] uppercase font-bold text-gray-400">Attendance</p>
              <p className="text-lg font-extrabold">{todaysOverview.attendanceToday ?? '—'}</p>
            </div>
            <div className="bg-gray-50 border rounded-xl p-3">
              <p className="text-[10px] uppercase font-bold text-gray-400">Payments</p>
              <p className="text-base font-extrabold truncate">{todaysOverview.feePaymentsToday ?? '—'}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Quick Operations</h3>
          <div className="space-y-2">
            <button onClick={() => navigate('/announcements')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 text-left">
              <span className="material-symbols-outlined text-green-600">campaign</span> New Announcement
            </button>
            <button onClick={() => navigate('/placements')} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 text-left">
              <span className="material-symbols-outlined text-indigo-600">work</span> New Placement Drive
            </button>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <h3 className="text-sm font-bold text-gray-900">Student Risk Identification</h3>
          <div className="flex gap-1 bg-gray-50 p-0.5 rounded-lg">
            {[
              { key: 'lowAttendance', label: 'Low Attendance' },
              { key: 'feePending',    label: 'Fee Pending' },
              { key: 'backlogs',      label: 'Backlogs' },
              { key: 'lowCgpa',       label: 'Low CGPA' }
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setRiskTab(key)} className={`px-2 py-1 text-xs font-medium rounded ${riskTab === key ? 'bg-white shadow' : ''}`}>{label}</button>
            ))}
          </div>
        </div>
        <table className="w-full text-left">
          <thead><tr className="text-[10px] uppercase text-gray-400"><th>Name</th><th>Roll</th><th>Metric</th></tr></thead>
          <tbody>
            {riskStudents[riskTab]?.map((stu, i) => (
              <tr key={i} className="border-t">
                <td className="py-2 text-sm">{stu.name}</td>
                <td className="py-2 text-sm">{stu.roll}</td>
                <td className="py-2 text-sm text-red-600 font-bold">{stu.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-bold mb-4">Attendance Distribution</h3>
          <div className="space-y-3">
            {attendance.branchComparison?.map((item, idx) => (
              <div key={idx}>
                <div className="flex justify-between text-xs font-semibold">{item.branch} <span>{item.avgPct}%</span></div>
                <div className="w-full bg-gray-100 h-2 rounded-full"><div className="bg-emerald-500 h-full rounded-full" style={{ width: `${item.avgPct}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold mb-4">CGPA Distribution</h3>
          <div className="space-y-2">
            {[
              { range: 'CGPA > 9', val: cgpa.above9, max: kpi.totalStudents || 500, color: 'bg-indigo-500' },
              { range: 'CGPA 8–9', val: cgpa['8to9'], max: kpi.totalStudents || 500, color: 'bg-blue-500' },
              { range: 'CGPA 7–8', val: cgpa['7to8'], max: kpi.totalStudents || 500, color: 'bg-emerald-500' },
              { range: 'CGPA 6–7', val: cgpa['6to7'], max: kpi.totalStudents || 500, color: 'bg-yellow-500' },
              { range: 'Below 6', val: cgpa.below6, max: kpi.totalStudents || 500, color: 'bg-red-500' }
            ].map((tier, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-gray-600">{tier.range}</span>
                <div className="flex-1 bg-gray-100 h-2 rounded">
                  <div className={`${tier.color} h-full rounded transition-all duration-500`} style={{ width: tier.max > 0 ? `${Math.round((tier.val / tier.max) * 100)}%` : '0%' }} />
                </div>
                <span className="text-gray-500 tabular-nums w-8 text-right">{tier.val}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="p-5 border-b flex justify-between items-center">
          <h3 className="text-sm font-bold">System Log</h3>
          <span className="text-[10px] font-bold uppercase text-gray-400">Live Feed</span>
        </div>
        <div className="p-5 space-y-4 max-h-[480px] overflow-y-auto">
          {logs.map(log => {
            const cfg = LOG_ICON[log.action] || { icon: 'info', cls: 'text-blue-600 bg-blue-50' };
            return (
              <div key={log.id} className="flex gap-3 items-center">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cfg.cls}`}>
                  <span className="material-symbols-outlined text-sm">{cfg.icon}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold">{log.details}</p>
                  <p className="text-[10px] text-gray-400">{new Date(log.timestamp).toLocaleString()}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
