import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

export default function Students() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Drawer tab details
  const [attendanceDetails, setAttendanceDetails] = useState([]);
  const [feeDetails, setFeeDetails] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState('profile');

  // Search & Filter State
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [semFilter, setSemFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [secFilter, setSecFilter] = useState('ALL');
  const [genderFilter, setGenderFilter] = useState('ALL');
  const [hostelFilter, setHostelFilter] = useState('ALL');
  const [feeStatusFilter, setFeeStatusFilter] = useState('ALL');
  const [attStatusFilter, setAttStatusFilter] = useState('ALL');
  const [placementFilter, setPlacementFilter] = useState('ALL');

  // Sorting State
  const [sortField, setSortField] = useState('roll');
  const [sortOrder, setSortOrder] = useState('asc'); // asc | desc

  // Pagination State
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch all students (wrapped in dashboard stats call)
  const fetchStudents = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/admin/dashboard/stats')
      .then(res => {
        setStudents(res.data.students || []);
      })
      .catch(err => {
        setError('Failed to fetch students dataset. Please try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  // Fetch student detailed data on drawer open
  const openDrawer = async (student) => {
    setSelectedStudent(student);
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerTab('profile');
    setAttendanceDetails([]);
    setFeeDetails(null);

    try {
      const [attRes, feeRes] = await Promise.all([
        api.get(`/student/${student.id}/attendance`),
        api.get(`/student/${student.id}/fees`)
      ]);
      setAttendanceDetails(attRes.data.attendance || []);
      setFeeDetails(feeRes.data || null);
    } catch (_) {
      console.warn('Failed to load on-demand student drawer data.');
    } finally {
      setDrawerLoading(false);
    }
  };

  // Export as CSV
  const handleExport = () => {
    const headers = 'Roll Number,Name,Email,Branch,Semester,Section,CGPA,Attendance %,Hostel,Fee Dues,Placement\n';
    const rows = students.map(s => `"${s.roll}","${s.name}","${s.email}","${s.branch}","${s.semester}","${s.section}","${s.cgpa}","${s.avgPct}%","${s.hostel}","${s.feesDue}","${s.placementStatus}"`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SITAM_Students_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  // Summary Metrics calculations
  const metrics = useMemo(() => {
    if (students.length === 0) return { total: 0, active: 0, hostellers: 0, dayScholars: 0, avgCgpa: 0, avgAttendance: 0 };
    const total = students.length;
    const hostellers = students.filter(s => (s.hostel || '').toLowerCase() === 'yes').length;
    const dayScholars = total - hostellers;
    const cgpas = students.map(s => parseFloat(s.cgpa) || 0);
    const avgCgpa = (cgpas.reduce((sum, c) => sum + c, 0) / total).toFixed(2);
    const atts = students.map(s => s.avgPct || 0);
    const avgAttendance = (atts.reduce((sum, a) => sum + a, 0) / total).toFixed(1);
    return { total, active: total, hostellers, dayScholars, avgCgpa, avgAttendance };
  }, [students]);

  // Filtering Logic
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      // 1. Search Query
      const query = search.toLowerCase();
      const matchSearch =
        s.name.toLowerCase().includes(query) ||
        s.roll.toLowerCase().includes(query) ||
        (s.email || '').toLowerCase().includes(query) ||
        (s.phone || '').includes(query) ||
        (s.admissionNo || '').toLowerCase().includes(query);

      if (!matchSearch) return false;

      // 2. Select Dropdowns
      if (branchFilter !== 'ALL' && s.branch !== branchFilter) return false;
      if (semFilter !== 'ALL' && s.semester !== semFilter) return false;
      if (yearFilter !== 'ALL' && s.year !== yearFilter) return false;
      if (secFilter !== 'ALL' && s.section !== secFilter) return false;
      if (genderFilter !== 'ALL' && (s.gender || '').toUpperCase() !== genderFilter.toUpperCase()) return false;
      if (hostelFilter !== 'ALL' && (s.hostel || '').toUpperCase() !== hostelFilter.toUpperCase()) return false;

      if (feeStatusFilter !== 'ALL') {
        const hasDues = s.feesDue > 0;
        if (feeStatusFilter === 'PAID' && hasDues) return false;
        if (feeStatusFilter === 'UNPAID' && !hasDues) return false;
      }

      if (attStatusFilter !== 'ALL') {
        const att = s.avgPct || 0;
        if (attStatusFilter === 'SAFE' && att < 75) return false;
        if (attStatusFilter === 'DEFAULTER' && att >= 75) return false;
      }

      if (placementFilter !== 'ALL' && s.placementStatus !== placementFilter) return false;

      return true;
    });
  }, [students, search, branchFilter, semFilter, yearFilter, secFilter, genderFilter, hostelFilter, feeStatusFilter, attStatusFilter, placementFilter]);

  // Sorting Logic
  const sortedStudents = useMemo(() => {
    const sorted = [...filteredStudents];
    sorted.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      // Handle numerical values
      if (sortField === 'cgpa') {
        valA = parseFloat(a.cgpa) || 0;
        valB = parseFloat(b.cgpa) || 0;
      } else if (sortField === 'avgPct') {
        valA = a.avgPct || 0;
        valB = b.avgPct || 0;
      } else if (sortField === 'feesDue') {
        valA = a.feesDue || 0;
        valB = b.feesDue || 0;
      } else {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredStudents, sortField, sortOrder]);

  // Pagination bounds
  const totalPages = Math.ceil(sortedStudents.length / pageSize) || 1;
  const paginatedStudents = useMemo(() => {
    if (pageSize === -1) return sortedStudents;
    const start = (currentPage - 1) * pageSize;
    return sortedStudents.slice(start, start + pageSize);
  }, [sortedStudents, currentPage, pageSize]);

  // Reset page when search or filter updates
  useEffect(() => {
    setCurrentPage(1);
  }, [search, branchFilter, semFilter, yearFilter, secFilter, genderFilter, hostelFilter, feeStatusFilter, attStatusFilter, placementFilter, pageSize]);

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Student Information Ledger</h2>
          <p className="text-xs text-gray-400 mt-1">Manage, filter, and inspect registered students information</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchStudents} className="btn-icon" title="Refresh"><span className="material-symbols-outlined text-[18px]">refresh</span></button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
            <span className="material-symbols-outlined text-[15px]">download</span> Export Report
          </button>
        </div>
      </section>

      {/* Summary KPI Widgets */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <StatCard key={i} loading />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard title="Total Enrolled" value={metrics.total} icon="groups" color="blue" />
          <StatCard title="Active Status" value={metrics.active} icon="verified" color="green" />
          <StatCard title="Hostellers" value={metrics.hostellers} icon="hotel" color="indigo" />
          <StatCard title="Day Scholars" value={metrics.dayScholars} icon="home" color="yellow" />
          <StatCard title="Average CGPA" value={metrics.avgCgpa} icon="star" color="violet" />
          <StatCard title="Avg Attendance" value={`${metrics.avgAttendance}%`} icon="event_available" color="emerald" />
        </section>
      )}

      {/* Search and Filters Bar */}
      <section className="card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-2.5 material-symbols-outlined text-gray-400 text-[18px]">search</span>
            <input
              type="text"
              placeholder="Search by name, roll, email, phone, or admission number..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-2 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Branch</label>
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All Branches</option>
              <option value="CSE">CSE</option>
              <option value="IT">IT</option>
              <option value="ECE">ECE</option>
              <option value="EEE">EEE</option>
              <option value="MECH">MECH</option>
              <option value="CIVIL">CIVIL</option>
              <option value="AIML">AIML</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Semester</label>
            <select value={semFilter} onChange={e => setSemFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All Sems</option>
              {['1','2','3','4','5','6','7','8'].map(s => <option key={s} value={s}>Sem {s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Year</label>
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All Years</option>
              <option value="1">1st Year</option>
              <option value="2">2nd Year</option>
              <option value="3">3rd Year</option>
              <option value="4">4th Year</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Section</label>
            <select value={secFilter} onChange={e => setSecFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All Sections</option>
              <option value="A">Section A</option>
              <option value="B">Section B</option>
              <option value="C">Section C</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Gender</label>
            <select value={genderFilter} onChange={e => setGenderFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Hostel</label>
            <select value={hostelFilter} onChange={e => setHostelFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All</option>
              <option value="Yes">Hosteller</option>
              <option value="No">Day Scholar</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Fee Status</label>
            <select value={feeStatusFilter} onChange={e => setFeeStatusFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All</option>
              <option value="PAID">Fully Paid</option>
              <option value="UNPAID">Pending Dues</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Attendance</label>
            <select value={attStatusFilter} onChange={e => setAttStatusFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All</option>
              <option value="SAFE">Safe (≥75%)</option>
              <option value="DEFAULTER">Defaulter (&lt;75%)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Placement</label>
            <select value={placementFilter} onChange={e => setPlacementFilter(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="ALL">All</option>
              <option value="Placed">Placed</option>
              <option value="Not Placed">Not Placed</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-500">Sort Field</label>
            <select value={sortField} onChange={e => setSortField(e.target.value)} className="border p-1.5 rounded-lg">
              <option value="roll">Roll Number</option>
              <option value="name">Name</option>
              <option value="cgpa">CGPA</option>
              <option value="avgPct">Attendance %</option>
              <option value="feesDue">Fees Due</option>
              <option value="branch">Branch</option>
            </select>
          </div>
        </div>

        {/* Sort Order Toggle */}
        <div className="flex items-center gap-4 border-t pt-3 justify-end text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-500">Sort Order:</span>
            <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} className="font-bold text-blue-600 hover:underline">
              {sortOrder === 'asc' ? 'Ascending (A-Z)' : 'Descending (Z-A)'}
            </button>
          </div>
        </div>
      </section>

      {/* Student Table */}
      <section className="card overflow-hidden">
        {loading ? (
          <div className="p-10 space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}
          </div>
        ) : error ? (
          <div className="p-10 text-center text-red-500 flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-4xl">error</span>
            <p className="font-bold">{error}</p>
            <button onClick={fetchStudents} className="btn-icon">Retry</button>
          </div>
        ) : paginatedStudents.length === 0 ? (
          <div className="p-16 text-center">
            <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3">group_off</span>
            <h4 className="text-sm font-bold text-gray-700">No students matches found</h4>
            <p className="text-xs text-gray-400 mt-1">Try relaxing your search terms or filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                  <th className="p-3 pl-5">Photo</th>
                  <th className="p-3">Roll Number</th>
                  <th className="p-3">Student Name</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3">Sem</th>
                  <th className="p-3">Sec</th>
                  <th className="p-3">Attendance</th>
                  <th className="p-3">CGPA</th>
                  <th className="p-3">Fees Due</th>
                  <th className="p-3">Placement</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right pr-5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm text-gray-700">
                {paginatedStudents.map(student => (
                  <tr key={student.id} className="hover:bg-gray-50/40 transition-colors">
                    <td className="p-3 pl-5">
                      <img src={student.photoUrl || 'https://ui-avatars.com/api/?name=Student'} alt={student.name} className="w-8 h-8 rounded-full border bg-gray-100 object-cover" />
                    </td>
                    <td className="p-3 font-semibold text-gray-900 tabular-nums">{student.roll}</td>
                    <td className="p-3 font-semibold text-gray-800">{student.name}</td>
                    <td className="p-3 font-bold text-gray-400">{student.branch}</td>
                    <td className="p-3 tabular-nums">{student.semester}</td>
                    <td className="p-3">{student.section}</td>
                    <td className="p-3 tabular-nums font-semibold">
                      <span className={student.avgPct >= 75 ? 'text-emerald-600' : 'text-red-500 font-bold'}>
                        {student.avgPct}%
                      </span>
                    </td>
                    <td className="p-3 tabular-nums font-bold text-gray-900">{student.cgpa}</td>
                    <td className="p-3 tabular-nums text-xs">
                      {student.feesDue > 0 ? (
                        <span className="text-red-500 font-bold">₹{student.feesDue.toLocaleString('en-IN')}</span>
                      ) : (
                        <span className="text-emerald-600 font-bold">Cleared</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge text={student.placementStatus} color={student.placementStatus === 'Placed' ? 'green' : 'gray'} />
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                      </span>
                    </td>
                    <td className="p-3 text-right pr-5">
                      <button onClick={() => openDrawer(student)} className="px-2.5 py-1 text-xs font-bold text-blue-600 hover:text-white hover:bg-blue-600 rounded border border-blue-200 transition-colors">
                        View Profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Pagination Controller */}
        {!loading && sortedStudents.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t text-xs text-gray-500 bg-gray-50/20">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-400">Page size:</span>
              <select value={pageSize} onChange={e => setPageSize(parseInt(e.target.value))} className="border p-1 rounded font-bold">
                <option value={25}>25 students</option>
                <option value={50}>50 students</option>
                <option value={100}>100 students</option>
                <option value={-1}>Show All</option>
              </select>
              <span>Showing {Math.min(sortedStudents.length, (currentPage-1)*pageSize + 1)}-{Math.min(sortedStudents.length, currentPage*pageSize)} of {sortedStudents.length} entries</span>
            </div>
            {pageSize !== -1 && (
              <div className="flex items-center gap-1">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(c => c - 1)} className="btn-icon p-1 disabled:opacity-50">
                  <span className="material-symbols-outlined text-sm">chevron_left</span>
                </button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-6 h-6 rounded font-bold transition-colors ${currentPage === i + 1 ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-gray-100'}`}>
                    {i + 1}
                  </button>
                ))}
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(c => c + 1)} className="btn-icon p-1 disabled:opacity-50">
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Student Profile Drawer ── */}
      {drawerOpen && selectedStudent && (
        <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 overflow-hidden">
            {/* Dark glass backdrop overlay */}
            <div onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />

            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <div className="pointer-events-auto w-screen max-w-2xl transform bg-white shadow-2xl transition-transform duration-500 ease-in-out border-l">
                <div className="flex h-full flex-col overflow-y-auto">
                  {/* Drawer Header */}
                  <div className="bg-gray-50 border-b px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={selectedStudent.photoUrl} alt={selectedStudent.name} className="w-10 h-10 rounded-full border object-cover bg-white" />
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">{selectedStudent.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{selectedStudent.roll} – Branch {selectedStudent.branch}</p>
                      </div>
                    </div>
                    <button onClick={() => setDrawerOpen(false)} className="btn-icon">
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>

                  {/* Drawer Tab Selectors */}
                  <div className="flex border-b text-xs font-semibold bg-gray-50/50">
                    <button onClick={() => setDrawerTab('profile')} className={`flex-1 py-3 text-center border-b-2 transition-colors ${drawerTab === 'profile' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Profile Detail</button>
                    <button onClick={() => setDrawerTab('attendance')} className={`flex-1 py-3 text-center border-b-2 transition-colors ${drawerTab === 'attendance' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Attendance Ledger</button>
                    <button onClick={() => setDrawerTab('fees')} className={`flex-1 py-3 text-center border-b-2 transition-colors ${drawerTab === 'fees' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Fees & Demands</button>
                  </div>

                  {/* Drawer Content */}
                  <div className="flex-1 p-5 space-y-6 text-xs text-gray-700">
                    {drawerLoading ? (
                      <div className="space-y-4">
                        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-8 w-full rounded" />)}
                      </div>
                    ) : drawerTab === 'profile' ? (
                      <div className="space-y-5">
                        {/* Personal Information */}
                        <div className="space-y-2">
                          <h4 className="font-extrabold uppercase text-gray-400 border-b pb-1">Personal Details</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div><p className="font-semibold text-gray-400">Date of Birth</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.dob || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Gender</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.gender || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Email Address</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.email || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Mobile Phone</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.phone || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Blood Group</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.bloodGroup || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Aadhar UID</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.aadhar || '—'}</p></div>
                          </div>
                        </div>

                        {/* Academic Details */}
                        <div className="space-y-2">
                          <h4 className="font-extrabold uppercase text-gray-400 border-b pb-1">Academics Details</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div><p className="font-semibold text-gray-400">Program / Degree</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.program || 'B.Tech'}</p></div>
                            <div><p className="font-semibold text-gray-400">Roll Number</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.roll || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Year / Semester</p><p className="font-bold text-gray-800 mt-0.5">Year {selectedStudent.year} – Semester {selectedStudent.semester}</p></div>
                            <div><p className="font-semibold text-gray-400">Section</p><p className="font-bold text-gray-800 mt-0.5">Section {selectedStudent.section}</p></div>
                            <div><p className="font-semibold text-gray-400">Admission No</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.admissionNo || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">SSC / Inter Marks</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.sscMarks} / {selectedStudent.interMarks}</p></div>
                            <div><p className="font-semibold text-gray-400">Seat Type</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.seatType || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Entrance Rank</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.entranceType}: {selectedStudent.entranceRank}</p></div>
                            <div><p className="font-semibold text-gray-400">Scholarship Type</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.scholarship || 'None'}</p></div>
                            <div><p className="font-semibold text-gray-400">Academic CGPA</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.cgpa} CGPA ({selectedStudent.percentage || '—'}%)</p></div>
                          </div>
                        </div>

                        {/* Parents & Contact */}
                        <div className="space-y-2">
                          <h4 className="font-extrabold uppercase text-gray-400 border-b pb-1">Parents &amp; Guardian</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div><p className="font-semibold text-gray-400">Father's Name</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.fatherName || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Father's Mobile</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.fatherMobile || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Mother's Name</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.motherName || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Guardian Name</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.guardianName || '—'}</p></div>
                            <div><p className="font-semibold text-gray-400">Guardian Contact</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.guardianPhone || '—'}</p></div>
                          </div>
                        </div>

                        {/* Hostel & Contact Address */}
                        <div className="space-y-2">
                          <h4 className="font-extrabold uppercase text-gray-400 border-b pb-1">Hostel &amp; Address Details</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div><p className="font-semibold text-gray-400">Hostel Allocation</p><p className="font-bold text-gray-800 mt-0.5">{selectedStudent.hostel === 'Yes' ? `Allocated Room ${selectedStudent.roomNo || 'N/A'}` : 'Day Scholar'}</p></div>
                            <div><p className="font-semibold text-gray-400">Permanent Address</p><p className="font-bold text-gray-800 mt-0.5 leading-snug">{selectedStudent.address || '—'}</p></div>
                          </div>
                        </div>
                      </div>
                    ) : drawerTab === 'attendance' ? (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center bg-gray-50 border p-3 rounded-xl">
                          <div>
                            <p className="font-semibold text-gray-400">Average Attendance</p>
                            <p className="text-xl font-bold text-gray-800">{selectedStudent.avgPct}%</p>
                          </div>
                          <Badge text={selectedStudent.avgPct >= 75 ? 'Safe' : 'Warning/Defaulter'} color={selectedStudent.avgPct >= 75 ? 'green' : 'red'} />
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-bold uppercase text-gray-400 mb-1">Subject-wise Class Records</h4>
                          {attendanceDetails.length === 0 ? (
                            <p className="text-center py-6 text-gray-400">No attendance records found</p>
                          ) : (
                            <div className="border rounded-xl overflow-hidden divide-y">
                              {attendanceDetails.map((a, idx) => (
                                <div key={idx} className="flex justify-between items-center p-3 hover:bg-gray-50/50">
                                  <div>
                                    <p className="font-bold text-gray-900">{a.subject}</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">Classes Attended: {a.present} / {a.total} held</p>
                                  </div>
                                  <span className={`font-bold tabular-nums ${a.percentage >= 75 ? 'text-emerald-600' : 'text-red-500'}`}>{a.percentage}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      // Fees tab details
                      <div className="space-y-4">
                        {feeDetails ? (
                          <>
                            <div className="grid grid-cols-3 gap-3 text-center bg-gray-50 border p-3.5 rounded-xl">
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Demand</p>
                                <p className="font-bold text-gray-900 mt-0.5">{feeDetails.totalAmount}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Paid</p>
                                <p className="font-bold text-emerald-600 mt-0.5">{feeDetails.paidAmount}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Dues</p>
                                <p className="font-bold text-red-500 mt-0.5">{feeDetails.dueAmount}</p>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <h4 className="font-bold uppercase text-gray-400 mb-1">Demands &amp; Transactions History</h4>
                              {(!feeDetails.transactions || feeDetails.transactions.length === 0) ? (
                                <p className="text-center py-6 text-gray-400">No transactions recorded</p>
                              ) : (
                                <div className="border rounded-xl divide-y">
                                  {feeDetails.transactions.map((t, idx) => (
                                    <div key={idx} className="p-3 flex justify-between items-center hover:bg-gray-50/50">
                                      <div>
                                        <p className="font-bold text-gray-900">{t.title}</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Due: {t.date} | Ref: {t.ref}</p>
                                      </div>
                                      <div className="text-right">
                                        <p className="font-extrabold text-gray-900">{t.amount}</p>
                                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide ${t.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' : (t.status === 'Partial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}`}>{t.status}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="text-center py-6 text-gray-400">No fee information resolved</p>
                        )}
                      </div>
                    )}
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
