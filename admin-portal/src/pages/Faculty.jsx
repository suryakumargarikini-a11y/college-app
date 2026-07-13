import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function Faculty() {
  const [faculties, setFaculties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFaculty, setSelectedFaculty] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Search & Filters
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');

  const fetchFaculty = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => {
        setFaculties(res.data.faculties || []);
      })
      .catch(() => setError('Failed to fetch faculty list.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchFaculty();
  }, [fetchFaculty]);

  // Calculations for summary metrics
  const metrics = useMemo(() => {
    if (faculties.length === 0) return { total: 0, cse: 0, ece: 0, avgCourses: 0 };
    const total = faculties.length;
    const cse = faculties.filter(f => f.dept === 'CSE').length;
    const ece = faculties.filter(f => f.dept === 'ECE').length;
    const totalCourses = faculties.reduce((sum, f) => sum + (f.coursesHandled || 0), 0);
    const avgCourses = (totalCourses / total).toFixed(1);
    return { total, cse, ece, avgCourses };
  }, [faculties]);

  // Filtering
  const filteredFaculty = useMemo(() => {
    return faculties.filter(f => {
      const query = search.toLowerCase();
      const matchSearch =
        f.name.toLowerCase().includes(query) ||
        f.email.toLowerCase().includes(query) ||
        (f.phone || '').includes(query);

      if (!matchSearch) return false;
      if (branchFilter !== 'ALL' && f.dept !== branchFilter) return false;

      return true;
    });
  }, [faculties, search, branchFilter]);

  return (
    <div className="space-y-6 fade-in">
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Faculty Directory</h2>
          <p className="text-xs text-gray-400 mt-1">Manage institutional departments and faculty lecture metrics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchFaculty} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
        </div>
      </section>

      {/* Summary Stats */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <StatCard key={i} loading />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard title="Total Instructors" value={metrics.total} icon="groups" color="blue" />
          <StatCard title="CSE Staff" value={metrics.cse} icon="terminal" color="emerald" />
          <StatCard title="ECE Staff" value={metrics.ece} icon="developer_board" color="indigo" />
          <StatCard title="Avg Courses Handled" value={metrics.avgCourses} icon="import_contacts" color="yellow" />
        </section>
      )}

      {/* Filters Bar */}
      <section className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-2.5 material-symbols-outlined text-gray-400 text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search by instructor name, email or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="w-full sm:w-48 flex flex-col gap-1 text-xs">
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="border p-2.5 rounded-xl font-medium bg-white">
            <option value="ALL">All Departments</option>
            <option value="CSE">CSE</option>
            <option value="ECE">ECE</option>
            <option value="AIML">AIML</option>
            <option value="IT">IT</option>
            <option value="MECH">MECH</option>
          </select>
        </div>
      </section>

      {/* Faculty Table */}
      <section className="card overflow-hidden">
        {loading ? (
          <div className="p-10 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}
          </div>
        ) : error ? (
          <div className="p-10 text-center text-red-500 flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-4xl">error</span>
            <p className="font-bold">{error}</p>
            <button onClick={fetchFaculty} className="btn-icon">Retry</button>
          </div>
        ) : filteredFaculty.length === 0 ? (
          <div className="p-16 text-center">
            <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3">person_off</span>
            <h4 className="text-sm font-bold text-gray-700">No instructors match the filters</h4>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                  <th className="p-4 pl-5">Faculty Name</th>
                  <th className="p-4">Department</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4 text-center">Courses Handled</th>
                  <th className="p-4 text-center">Avg Attendance</th>
                  <th className="p-4 text-center">Graded Submissions</th>
                  <th className="p-4 text-right pr-5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm text-gray-700">
                {filteredFaculty.map(faculty => (
                  <tr key={faculty.id} className="hover:bg-gray-50/40 transition-colors">
                    <td className="p-4 pl-5 font-semibold text-gray-900">{faculty.name}</td>
                    <td className="p-4 font-bold text-gray-400">{faculty.dept}</td>
                    <td className="p-4 text-xs font-semibold text-gray-600">{faculty.email}</td>
                    <td className="p-4 tabular-nums text-xs">{faculty.phone}</td>
                    <td className="p-4 text-center font-bold text-indigo-600 tabular-nums">{faculty.coursesHandled}</td>
                    <td className="p-4 text-center text-emerald-600 font-bold tabular-nums">{faculty.avgAttendance}%</td>
                    <td className="p-4 text-center text-gray-500 tabular-nums">{faculty.submissionsGraded}</td>
                    <td className="p-4 text-right pr-5">
                      <button onClick={() => { setSelectedFaculty(faculty); setDrawerOpen(true); }} className="px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded border border-blue-200">
                        View Profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Drawer */}
      {drawerOpen && selectedFaculty && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
          <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
            <div className="w-screen max-w-lg bg-white shadow-2xl border-l flex flex-col h-full overflow-y-auto">
              <div className="bg-gray-50 border-b px-5 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{selectedFaculty.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedFaculty.role} – Dept {selectedFaculty.dept}</p>
                </div>
                <button onClick={() => setDrawerOpen(false)} className="btn-icon">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-5 space-y-6 text-xs text-gray-700">
                <div className="space-y-2">
                  <h4 className="font-extrabold uppercase text-gray-400 border-b pb-1">Instructor Profile Details</h4>
                  <div className="space-y-3">
                    <div><p className="font-semibold text-gray-400">Primary Email</p><p className="font-bold text-gray-800 mt-0.5">{selectedFaculty.email}</p></div>
                    <div><p className="font-semibold text-gray-400">Mobile Phone</p><p className="font-bold text-gray-800 mt-0.5">{selectedFaculty.phone}</p></div>
                    <div><p className="font-semibold text-gray-400">Department Title</p><p className="font-bold text-gray-800 mt-0.5">{selectedFaculty.deptName}</p></div>
                    <div><p className="font-semibold text-gray-400">Handled Courses</p><p className="font-bold text-gray-800 mt-0.5 leading-snug">{selectedFaculty.coursesList || 'None'}</p></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-extrabold uppercase text-gray-400 border-b pb-1">Academic &amp; LMS Statistics</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-2.5 rounded-lg border">
                      <p className="font-semibold text-gray-400">Handled Courses</p>
                      <p className="text-base font-extrabold text-indigo-600 mt-0.5">{selectedFaculty.coursesHandled}</p>
                    </div>
                    <div className="bg-gray-50 p-2.5 rounded-lg border">
                      <p className="font-semibold text-gray-400">Avg Student Attendance</p>
                      <p className="text-base font-extrabold text-emerald-600 mt-0.5">{selectedFaculty.avgAttendance}%</p>
                    </div>
                    <div className="bg-gray-50 p-2.5 rounded-lg border">
                      <p className="font-semibold text-gray-400">Assignments Posted</p>
                      <p className="text-base font-extrabold text-gray-800 mt-0.5">{selectedFaculty.assignmentsPosted}</p>
                    </div>
                    <div className="bg-gray-50 p-2.5 rounded-lg border">
                      <p className="font-semibold text-gray-400">Submissions Graded</p>
                      <p className="text-base font-extrabold text-gray-800 mt-0.5">{selectedFaculty.submissionsGraded}</p>
                    </div>
                    <div className="bg-gray-50 p-2.5 rounded-lg border">
                      <p className="font-semibold text-gray-400">Quizzes Conducted</p>
                      <p className="text-base font-extrabold text-gray-800 mt-0.5">{selectedFaculty.quizzesConducted}</p>
                    </div>
                    <div className="bg-gray-50 p-2.5 rounded-lg border">
                      <p className="font-semibold text-gray-400">Average Quiz Score</p>
                      <p className="text-base font-extrabold text-blue-600 mt-0.5">{selectedFaculty.avgQuizScore}%</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
