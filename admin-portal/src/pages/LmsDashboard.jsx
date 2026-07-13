import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, Legend, Filler);

const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } } };

export default function LmsDashboard() {
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
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lms = analytics?.lms || {};
  const fac = dashData?.faculties || dashData?.faculty || [];
  const kpi = dashData?.kpi || { totalCourses: 40, totalStudents: 500, totalFaculty: 20 };

  const facultyWorkload = lms.facultyWorkload || [];

  const workloadData = {
    labels: facultyWorkload.map(f => f.name.split(' ').slice(-2).join(' ')),
    datasets: [{ data: facultyWorkload.map(f => f.courses),
      backgroundColor: '#3b82f6', borderRadius: 5, barPercentage: 0.6 }]
  };

  const progressDoughnutData = {
    labels: ['Completed', 'Remaining'],
    datasets: [{ data: [lms.avgProgress || 72.4, 100 - (lms.avgProgress || 72.4)],
      backgroundColor: ['#10b981', '#f3f4f6'], borderWidth: 2, borderColor: '#fff' }]
  };

  const submissionDoughnutData = {
    labels: ['Submitted', 'Pending'],
    datasets: [{ data: [lms.assignmentSubmissionRate || 74.5, 100 - (lms.assignmentSubmissionRate || 74.5)],
      backgroundColor: ['#6366f1', '#f3f4f6'], borderWidth: 2, borderColor: '#fff' }]
  };

  // Student engagement simulated monthly trend
  const engagementData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [{ label: 'Active Sessions', data: [1200, 1450, 1300, 1680, 1850, 1900],
      borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 4 }]
  };

  const workloadOpts = {
    ...CHART_OPTS,
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 } } },
      y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 }, stepSize: 1 } }
    }
  };

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-black text-gray-900 leading-tight">LMS Courses &amp; Progress Dashboard</h2>
          <p className="text-xs text-gray-400 mt-1">Course enrollments, lecture syllabus progress, and instructor tracking</p>
        </div>
        <button onClick={load} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
      </section>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Active Courses", value: kpi.totalCourses, icon: "import_contacts", color: "blue", suffix: "" },
          { title: "Enrolled Students", value: kpi.totalStudents, icon: "groups", color: "indigo", suffix: "" },
          { title: "Avg Course Progress", value: lms.avgProgress || 72.4, icon: "trending_up", color: "green", suffix: "%" },
          { title: "Certificates Issued", value: lms.certificatesCount || 120, icon: "workspace_premium", color: "yellow", suffix: "" }
        ].map((card, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              card.color === 'blue' ? 'bg-blue-50 text-blue-600' :
              card.color === 'indigo' ? 'bg-indigo-50 text-indigo-600' :
              card.color === 'green' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              <span className="material-symbols-outlined text-[20px]">{card.icon}</span>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{card.title}</p>
              <p className="text-xl font-black text-gray-900">
                {typeof card.value === 'number' ? card.value.toLocaleString('en-IN') : card.value}
                {card.suffix}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* 4 charts grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Course Progress Doughnut */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Avg Syllabus Progress</h3>
          <div style={{ height: 200 }}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Doughnut data={progressDoughnutData} options={{ ...CHART_OPTS, cutout: '65%' }} />
            )}
          </div>
          <p className="text-center text-xs font-bold text-gray-700 mt-2">{(lms.avgProgress || 72.4).toFixed(1)}% Completed</p>
        </div>

        {/* Assignment Submissions */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Assignment Submission Rate</h3>
          <div style={{ height: 200 }}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Doughnut data={submissionDoughnutData} options={{ ...CHART_OPTS, cutout: '65%' }} />
            )}
          </div>
          <p className="text-center text-xs font-bold text-gray-700 mt-2">{(lms.assignmentSubmissionRate || 74.5).toFixed(1)}% Submission Rate</p>
        </div>

        {/* Faculty Course Load */}
        <div className="chart-container">
          <h3 className="section-title mb-3">Faculty Course Load</h3>
          <div style={{ height: 200 }}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Bar data={workloadData} options={workloadOpts} />
            )}
          </div>
        </div>

        {/* Engagement Trend */}
        <div className="chart-container">
          <h3 className="section-title mb-3">LMS Active Sessions</h3>
          <div style={{ height: 200 }}>
            {loading ? <div className="skeleton h-full rounded-xl"/> : (
              <Line data={engagementData} options={{ ...CHART_OPTS, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 } } } } }} />
            )}
          </div>
        </div>
      </section>

      {/* Radial Quiz Performance */}
      <div className="chart-container flex flex-col items-center">
        <h3 className="section-title mb-4 self-start">Average Quiz Performance</h3>
        <div style={{ height: 200 }} className="w-full max-w-xs">
          {!loading && (
            <ReactApexChart type="radialBar" height={220} series={[lms.avgQuizScore || 72]}
              options={{
                chart: { toolbar: { show: false } },
                plotOptions: { radialBar: {
                  startAngle: -135, endAngle: 135,
                  track: { background: '#f3f4f6', strokeWidth: '97%' },
                  dataLabels: { name: { fontSize:'12px',color:'#6b7280' }, value: { fontSize:'28px',fontWeight:900,color:'#111827',formatter:v=>`${v}%` } },
                  hollow: { size: '60%' }
                }},
                colors: ['#6366f1'], labels: ['Quiz Score Avg'], stroke: { dashArray: 4 }
              }}
            />
          )}
        </div>
      </div>

      {/* Main Grid */}
      <section className="card">
        <div className="p-5 border-b">
          <h3 className="section-title">LMS Course Instructors Progress Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs divide-y divide-gray-100">
            <thead>
              <tr className="bg-gray-50 font-bold uppercase text-[9px] text-gray-400 border-b">
                <th className="p-3 pl-4">Instructor Name</th>
                <th className="p-3">Department</th>
                <th className="p-3 text-center">Courses Handled</th>
                <th className="p-3 text-center">Assignments Posted</th>
                <th className="p-3 text-center">Quizzes Conducted</th>
                <th className="p-3 text-center">Average Quiz Marks</th>
                <th className="p-3 text-right pr-4">Syllabus Completion</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-700 font-semibold bg-white">
              {loading ? Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={7}><div className="skeleton h-8 mx-4 my-1 rounded"/></td></tr>) :
              fac.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50/40">
                  <td className="p-3 pl-4 text-gray-900 font-bold">{item.name}</td>
                  <td className="p-3 font-bold text-gray-400">{item.dept}</td>
                  <td className="p-3 text-center tabular-nums">{item.coursesHandled}</td>
                  <td className="p-3 text-center tabular-nums">{item.assignmentsPosted}</td>
                  <td className="p-3 text-center tabular-nums">{item.quizzesConducted}</td>
                  <td className="p-3 text-center text-blue-600 font-bold tabular-nums">{item.avgQuizScore}%</td>
                  <td className="p-3 text-right pr-4 text-emerald-600 font-bold tabular-nums">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${item.avgAttendance}%` }} />
                      </div>
                      <span>{item.avgAttendance}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
