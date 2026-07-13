import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function LmsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load LMS details.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kpi = data?.kpi || { totalCourses: 40, totalStudents: 500, totalFaculty: 20 };
  const fac = data?.faculty || [];

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">LMS Courses &amp; Progress Dashboard</h2>
          <p className="text-xs text-gray-400 mt-1">Course enrollments, lecture syllabus progress, and instructor tracking</p>
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
          <StatCard title="Active Courses" value={kpi.totalCourses} icon="import_contacts" color="blue" />
          <StatCard title="Enrolled Students" value={kpi.totalStudents} icon="groups" color="indigo" />
          <StatCard title="Average Course Progress" value="74.2%" icon="trending_up" color="green" />
          <StatCard title="Certificates Issued" value="48 offers" icon="workspace_premium" color="yellow" />
        </section>
      )}

      {/* Main Grid */}
      <section className="card p-5 space-y-6">
        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-4">LMS Course Instructors Progress Summary</h3>
          <div className="overflow-x-auto border rounded-xl divide-y">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-gray-50/50 font-bold uppercase text-[9px] text-gray-400 border-b">
                  <th className="p-3 pl-4">Instructor Name</th>
                  <th className="p-3">Department</th>
                  <th className="p-3 text-center">Courses Handled</th>
                  <th className="p-3 text-center">Assignments Posted</th>
                  <th className="p-3 text-center">Quizzes Conducted</th>
                  <th className="p-3 text-center">Average Quiz Marks</th>
                  <th className="p-3 text-right pr-4">Syllabus Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y text-gray-700 font-semibold">
                {fac.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/40">
                    <td className="p-3 pl-4 text-gray-900 font-bold">{item.name}</td>
                    <td className="p-3 font-bold text-gray-400">{item.dept}</td>
                    <td className="p-3 text-center tabular-nums">{item.coursesHandled}</td>
                    <td className="p-3 text-center tabular-nums">{item.assignmentsPosted}</td>
                    <td className="p-3 text-center tabular-nums">{item.quizzesConducted}</td>
                    <td className="p-3 text-center text-blue-600 font-bold tabular-nums">{item.avgQuizScore}%</td>
                    <td className="p-3 text-right pr-4 text-emerald-600 font-bold tabular-nums">85%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
