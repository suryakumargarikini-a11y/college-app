import React, { useEffect, useState, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import api from '../lib/api';
import { authStore } from '../store/authStore';
import Modal from '../components/Modal';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';
import Badge from '../components/Badge';
import TargetingSelector from '../components/TargetingSelector';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, Legend, Filler);

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
};

export default function LmsDashboard() {
  const currentUser = authStore.getUser();
  const userRole = currentUser?.role || 'SUPER_ADMIN';
  const { toasts, showToast, removeToast } = useToast();

  const isReadAllowed = ['SUPER_ADMIN', 'DEAN', 'CI', 'HOD', 'FACULTY'].includes(userRole);
  const isWriteAllowed = ['SUPER_ADMIN', 'HOD', 'FACULTY'].includes(userRole);

  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'assignments' | 'materials'
  const [loading, setLoading] = useState(true);

  // Overview Data
  const [analytics, setAnalytics] = useState(null);
  const [dashData, setDashData] = useState(null);

  // LMS Data
  const [courses, setCourses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [materials, setMaterials] = useState([]);

  // Assignment Modal State
  const [isAsnModalOpen, setIsAsnModalOpen] = useState(false);
  const [asnForm, setAsnForm] = useState({
    title: '', description: '', instructions: '', dueDate: '', maxMarks: 100,
    subjectId: '', branch: 'ALL', year: 'ALL', semester: 'ALL', section: 'ALL', attachmentUrl: ''
  });
  const [asnSaving, setAsnSaving] = useState(false);

  // Submissions Modal State
  const [selectedAsnForSubmissions, setSelectedAsnForSubmissions] = useState(null);
  const [submissionsList, setSubmissionsList] = useState([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);

  // Grade Modal State
  const [selectedSubForGrading, setSelectedSubForGrading] = useState(null);
  const [gradeForm, setGradeForm] = useState({ marks: '', feedback: '' });
  const [gradeSaving, setGradeSaving] = useState(false);

  // Study Material Modal State
  const [isMatModalOpen, setIsMatModalOpen] = useState(false);
  const [matForm, setMatForm] = useState({
    title: '', description: '', category: 'LECTURE_NOTE', subjectId: '',
    branch: '', year: '', semester: '', section: '', fileUrl: ''
  });
  const [matSaving, setMatSaving] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const [anlRes, dRes] = await Promise.all([
        api.get('/admin/analytics'),
        api.get('/admin/dashboard/stats')
      ]);
      setAnalytics(anlRes.data);
      setDashData(dRes.data);
    } catch (e) {
      console.warn('[LMS] Analytics load warning:', e);
    }
  }, []);

  const loadLmsData = useCallback(async () => {
    if (!isReadAllowed) return;
    try {
      const [cRes, aRes, mRes] = await Promise.all([
        api.get('/admin/lms/courses').catch(() => ({ data: { courses: [] } })),
        api.get('/admin/lms/assignments').catch(() => ({ data: { assignments: [] } })),
        api.get('/admin/lms/materials').catch(() => ({ data: { materials: [] } }))
      ]);
      setCourses(cRes.data?.courses || []);
      setAssignments(aRes.data?.assignments || []);
      setMaterials(mRes.data?.materials || []);
    } catch (e) {
      showToast('Failed to load LMS data', 'error');
    }
  }, [isReadAllowed]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadOverview(), loadLmsData()]);
    setLoading(false);
  }, [loadOverview, loadLmsData]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Handlers for Assignment Creation
  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    if (!asnForm.title || !asnForm.dueDate) {
      return showToast('Title and Due Date are required', 'error');
    }
    setAsnSaving(true);
    try {
      await api.post('/admin/lms/assignments', asnForm);
      showToast('Assignment published successfully!');
      setIsAsnModalOpen(false);
      setAsnForm({
        title: '', description: '', instructions: '', dueDate: '', maxMarks: 100,
        subjectId: '', branch: 'ALL', year: 'ALL', semester: 'ALL', section: 'ALL', attachmentUrl: ''
      });
      loadLmsData();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to create assignment', 'error');
    } finally {
      setAsnSaving(false);
    }
  };

  // Handlers for Viewing Submissions
  const handleOpenSubmissions = async (asn) => {
    setSelectedAsnForSubmissions(asn);
    setSubmissionsLoading(true);
    try {
      const res = await api.get(`/admin/lms/assignments/${asn.id}/submissions`);
      setSubmissionsList(res.data?.submissions || []);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to load submissions', 'error');
    } finally {
      setSubmissionsLoading(false);
    }
  };

  // Handlers for Grading Submission
  const handleOpenGrading = (sub) => {
    setSelectedSubForGrading(sub);
    setGradeForm({
      marks: sub.marks !== null && sub.marks !== undefined ? sub.marks : '',
      feedback: sub.feedback || ''
    });
  };

  const handleGradeSubmit = async (e) => {
    e.preventDefault();
    if (gradeForm.marks === '') {
      return showToast('Marks value is required', 'error');
    }
    setGradeSaving(true);
    try {
      await api.post(`/admin/lms/submissions/${selectedSubForGrading.id}/grade`, {
        marks: Number(gradeForm.marks),
        feedback: gradeForm.feedback
      });
      showToast('Submission graded successfully!');
      setSelectedSubForGrading(null);
      // Refresh submissions
      if (selectedAsnForSubmissions) {
        handleOpenSubmissions(selectedAsnForSubmissions);
      }
      loadLmsData();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to grade submission', 'error');
    } finally {
      setGradeSaving(false);
    }
  };

  // Handlers for Study Material Creation
  const handleCreateMaterial = async (e) => {
    e.preventDefault();
    if (!matForm.title) {
      return showToast('Title is required', 'error');
    }
    setMatSaving(true);
    try {
      await api.post('/admin/lms/materials', matForm);
      showToast('Study material published successfully!');
      setIsMatModalOpen(false);
      setMatForm({
        title: '', description: '', category: 'LECTURE_NOTE', subjectId: '',
        branch: '', year: '', semester: '', section: '', fileUrl: ''
      });
      loadLmsData();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to publish study material', 'error');
    } finally {
      setMatSaving(false);
    }
  };

  // Handler for Deleting Material
  const handleDeleteMaterial = async (id) => {
    if (!window.confirm('Are you sure you want to delete this study material?')) return;
    try {
      await api.delete(`/admin/lms/materials/${id}`);
      showToast('Material deleted');
      loadLmsData();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete material', 'error');
    }
  };

  if (!isReadAllowed) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-red-100 space-y-3">
        <span className="material-symbols-outlined text-4xl text-red-500">block</span>
        <h3 className="text-lg font-bold text-gray-900">Access Restricted</h3>
        <p className="text-xs text-gray-500 max-w-md mx-auto">
          Your administrative role ({userRole}) is not authorized to access LMS academic management.
        </p>
      </div>
    );
  }

  const lms = analytics?.lms || {};
  const fac = dashData?.faculties || dashData?.faculty || [];
  const kpi = dashData?.kpi || { totalCourses: courses.length || 40, totalStudents: 500, totalFaculty: 20 };
  const facultyWorkload = lms.facultyWorkload || [];

  const workloadData = {
    labels: facultyWorkload.map(f => f.name.split(' ').slice(-2).join(' ')),
    datasets: [{ data: facultyWorkload.map(f => f.courses), backgroundColor: '#3b82f6', borderRadius: 5, barPercentage: 0.6 }]
  };

  const progressDoughnutData = {
    labels: ['Completed', 'Remaining'],
    datasets: [{ data: [lms.avgProgress || 72.4, 100 - (lms.avgProgress || 72.4)], backgroundColor: ['#10b981', '#f3f4f6'], borderWidth: 2, borderColor: '#fff' }]
  };

  const submissionDoughnutData = {
    labels: ['Submitted', 'Pending'],
    datasets: [{ data: [lms.assignmentSubmissionRate || 74.5, 100 - (lms.assignmentSubmissionRate || 74.5)], backgroundColor: ['#6366f1', '#f3f4f6'], borderWidth: 2, borderColor: '#fff' }]
  };

  const engagementData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [{ label: 'Active Sessions', data: [1200, 1450, 1300, 1680, 1850, 1900], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 4 }]
  };

  return (
    <div className="space-y-6 fade-in max-w-7xl mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-xl font-black text-gray-900 leading-tight">SITAM LMS Hub &amp; Course Management</h2>
          <p className="text-xs text-gray-400 mt-1">Study materials, coursework, assignments, student submissions, and grading</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tabs */}
          <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === 'overview' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Overview &amp; Analytics
            </button>
            <button
              onClick={() => setActiveTab('assignments')}
              className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === 'assignments' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Assignments ({assignments.length})
            </button>
            <button
              onClick={() => setActiveTab('materials')}
              className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === 'materials' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Study Materials ({materials.length})
            </button>
          </div>

          <button onClick={loadAll} className="btn-icon" title="Refresh">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </section>

      {/* TAB 1: OVERVIEW & ANALYTICS */}
      {activeTab === 'overview' && (
        <div className="space-y-6 fade-in">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Active Courses", value: courses.length || kpi.totalCourses, icon: "import_contacts", color: "blue", suffix: "" },
              { title: "Active Assignments", value: assignments.length, icon: "assignment", color: "indigo", suffix: "" },
              { title: "Published Materials", value: materials.length, icon: "description", color: "green", suffix: "" },
              { title: "Avg Course Progress", value: lms.avgProgress || 72.4, icon: "trending_up", color: "yellow", suffix: "%" }
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

          {/* Charts Grid */}
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="chart-container">
              <h3 className="section-title mb-3">Avg Syllabus Progress</h3>
              <div style={{ height: 200 }}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Doughnut data={progressDoughnutData} options={{ ...CHART_OPTS, cutout: '65%' }} />
                )}
              </div>
              <p className="text-center text-xs font-bold text-gray-700 mt-2">{(lms.avgProgress || 72.4).toFixed(1)}% Completed</p>
            </div>

            <div className="chart-container">
              <h3 className="section-title mb-3">Assignment Submission Rate</h3>
              <div style={{ height: 200 }}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Doughnut data={submissionDoughnutData} options={{ ...CHART_OPTS, cutout: '65%' }} />
                )}
              </div>
              <p className="text-center text-xs font-bold text-gray-700 mt-2">{(lms.assignmentSubmissionRate || 74.5).toFixed(1)}% Submission Rate</p>
            </div>

            <div className="chart-container">
              <h3 className="section-title mb-3">Faculty Course Load</h3>
              <div style={{ height: 200 }}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Bar data={workloadData} options={CHART_OPTS} />
                )}
              </div>
            </div>

            <div className="chart-container">
              <h3 className="section-title mb-3">LMS Active Sessions</h3>
              <div style={{ height: 200 }}>
                {loading ? <div className="skeleton h-full rounded-xl"/> : (
                  <Line data={engagementData} options={CHART_OPTS} />
                )}
              </div>
            </div>
          </section>

          {/* Instructor Table */}
          <section className="card">
            <div className="p-5 border-b flex justify-between items-center">
              <h3 className="section-title">Department Instructors &amp; Syllabus Tracker</h3>
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
                    <th className="p-3 text-center">Avg Quiz Score</th>
                    <th className="p-3 text-right pr-4">Syllabus Progress</th>
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
      )}

      {/* TAB 2: ASSIGNMENTS HUB */}
      {activeTab === 'assignments' && (
        <div className="space-y-5 fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Assignments &amp; Grading Hub</h3>
              <p className="text-xs text-gray-500">Publish coursework, view student submissions, and provide grades/feedback</p>
            </div>
            {isWriteAllowed && (
              <button onClick={() => setIsAsnModalOpen(true)} className="btn-primary">
                <span className="material-symbols-outlined text-[18px]">add</span>
                Create Assignment
              </button>
            )}
          </div>

          <div className="card overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                <div className="skeleton h-10 rounded-xl"/>
                <div className="skeleton h-10 rounded-xl"/>
              </div>
            ) : assignments.length === 0 ? (
              <div className="p-12 text-center text-gray-400 space-y-3">
                <span className="material-symbols-outlined text-4xl block">assignment_turned_in</span>
                <p className="font-bold text-sm">No assignments published yet.</p>
                {isWriteAllowed && (
                  <button onClick={() => setIsAsnModalOpen(true)} className="btn-primary mx-auto">Create First Assignment</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="th">Assignment Title</th>
                      <th className="th">Course / Subject</th>
                      <th className="th">Target Scope</th>
                      <th className="th">Due Date</th>
                      <th className="th">Max Marks</th>
                      <th className="th text-center">Submissions</th>
                      <th className="th text-center">Pending Grading</th>
                      <th className="th text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map(asn => (
                      <tr key={asn.id} className="tr-hover">
                        <td className="td">
                          <p className="font-bold text-gray-900 text-sm">{asn.title}</p>
                          {asn.createdByName && <p className="text-[10px] text-gray-400">By: {asn.createdByName}</p>}
                        </td>
                        <td className="td font-semibold text-blue-600">
                          {asn.subjectCode || asn.subject?.code || 'General'}
                        </td>
                        <td className="td text-xs text-gray-500">
                          {asn.branch || 'ALL'} · Year {asn.year || 'ALL'} · Sem {asn.semester || 'ALL'}
                        </td>
                        <td className="td text-xs text-gray-700 whitespace-nowrap">
                          {new Date(asn.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="td font-bold text-gray-900">{asn.maxMarks}</td>
                        <td className="td text-center">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {asn.totalSubmissions || 0}
                          </span>
                        </td>
                        <td className="td text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            asn.pendingGrading > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-gray-50 text-gray-600'
                          }`}>
                            {asn.pendingGrading || 0}
                          </span>
                        </td>
                        <td className="td text-right">
                          <button
                            onClick={() => handleOpenSubmissions(asn)}
                            className="btn-secondary py-1 px-3 text-xs"
                          >
                            <span className="material-symbols-outlined text-[16px]">visibility</span>
                            Submissions ({asn.totalSubmissions})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: STUDY MATERIALS HUB */}
      {activeTab === 'materials' && (
        <div className="space-y-5 fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Study Materials Repository</h3>
              <p className="text-xs text-gray-500">Upload lecture notes, PDFs, PPTs, and reference documents for students</p>
            </div>
            {isWriteAllowed && (
              <button onClick={() => setIsMatModalOpen(true)} className="btn-primary">
                <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
                Upload Material
              </button>
            )}
          </div>

          <div className="card overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                <div className="skeleton h-10 rounded-xl"/>
                <div className="skeleton h-10 rounded-xl"/>
              </div>
            ) : materials.length === 0 ? (
              <div className="p-12 text-center text-gray-400 space-y-3">
                <span className="material-symbols-outlined text-4xl block">folder_open</span>
                <p className="font-bold text-sm">No study materials published yet.</p>
                {isWriteAllowed && (
                  <button onClick={() => setIsMatModalOpen(true)} className="btn-primary mx-auto">Upload First Material</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="th">Material Title</th>
                      <th className="th">Category</th>
                      <th className="th">Course / Subject</th>
                      <th className="th">Target Scope</th>
                      <th className="th">Uploaded By</th>
                      <th className="th">Published Date</th>
                      <th className="th text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map(mat => (
                      <tr key={mat.id} className="tr-hover">
                        <td className="td">
                          <p className="font-bold text-gray-900 text-sm">{mat.title}</p>
                          {mat.description && <p className="text-xs text-gray-400 truncate max-w-xs">{mat.description}</p>}
                        </td>
                        <td className="td">
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-gray-100 text-gray-700 uppercase">
                            {mat.category}
                          </span>
                        </td>
                        <td className="td font-semibold text-blue-600">
                          {mat.subject?.code || 'General'}
                        </td>
                        <td className="td text-xs text-gray-500">
                          {mat.branch || 'ALL'} · Year {mat.year || 'ALL'} · Sem {mat.semester || 'ALL'}
                        </td>
                        <td className="td text-xs text-gray-600">
                          {mat.uploadedByName || 'Faculty'}
                        </td>
                        <td className="td text-xs text-gray-400 whitespace-nowrap">
                          {new Date(mat.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="td text-right">
                          <div className="flex items-center justify-end gap-2">
                            {mat.fileUrl && (
                              <a href={mat.fileUrl} target="_blank" rel="noreferrer" className="btn-icon text-blue-600" title="View File">
                                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                              </a>
                            )}
                            {isWriteAllowed && (
                              <button onClick={() => handleDeleteMaterial(mat.id)} className="btn-icon text-red-400 hover:text-red-600" title="Delete">
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CREATE ASSIGNMENT */}
      <Modal isOpen={isAsnModalOpen} onClose={() => setIsAsnModalOpen(false)} title="Create New Assignment" size="lg">
        <form onSubmit={handleCreateAssignment} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
            <input className="input-field" value={asnForm.title} onChange={e => setAsnForm({ ...asnForm, title: e.target.value })} placeholder="e.g., Assignment 1: Relational Algebra Queries" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Course / Subject</label>
              <select className="input-field" value={asnForm.subjectId} onChange={e => setAsnForm({ ...asnForm, subjectId: e.target.value })}>
                <option value="">-- General / Select Subject --</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.code}: {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Due Date &amp; Time *</label>
              <input type="datetime-local" className="input-field" value={asnForm.dueDate} onChange={e => setAsnForm({ ...asnForm, dueDate: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Max Marks</label>
              <input type="number" className="input-field" value={asnForm.maxMarks} onChange={e => setAsnForm({ ...asnForm, maxMarks: e.target.value })} min={1} max={1000} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Department</label>
              <select className="input-field" value={asnForm.branch} onChange={e => setAsnForm({ ...asnForm, branch: e.target.value })}>
                <option value="ALL">ALL (All Depts)</option>
                <option value="AIDS">AIDS</option>
                <option value="AIML">AIML</option>
                <option value="CSE">CSE</option>
                <option value="ECE">ECE</option>
                <option value="IT">IT</option>
                <option value="MECH">MECH</option>
                <option value="CIVIL">CIVIL</option>
                <option value="EEE">EEE</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Year</label>
              <select className="input-field" value={asnForm.year} onChange={e => setAsnForm({ ...asnForm, year: e.target.value })}>
                <option value="ALL">ALL Years</option>
                <option value="1">Year 1</option>
                <option value="2">Year 2</option>
                <option value="3">Year 3</option>
                <option value="4">Year 4</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
              <select className="input-field" value={asnForm.semester} onChange={e => setAsnForm({ ...asnForm, semester: e.target.value })}>
                <option value="ALL">ALL Semesters</option>
                <option value="1">Sem 1</option>
                <option value="2">Sem 2</option>
                <option value="3">Sem 3</option>
                <option value="4">Sem 4</option>
                <option value="5">Sem 5</option>
                <option value="6">Sem 6</option>
                <option value="7">Sem 7</option>
                <option value="8">Sem 8</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Instructions / Description</label>
            <textarea className="input-field h-24 resize-none" value={asnForm.description} onChange={e => setAsnForm({ ...asnForm, description: e.target.value })} placeholder="Detailed instructions for students…" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Attachment / Reference URL (optional)</label>
            <input type="url" className="input-field" value={asnForm.attachmentUrl} onChange={e => setAsnForm({ ...asnForm, attachmentUrl: e.target.value })} placeholder="https://drive.google.com/... or resource link" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setIsAsnModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={asnSaving}>
              {asnSaving ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Publish Assignment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: VIEW SUBMISSIONS & GRADING */}
      <Modal isOpen={!!selectedAsnForSubmissions} onClose={() => setSelectedAsnForSubmissions(null)} title={`Submissions: ${selectedAsnForSubmissions?.title}`} size="xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl text-xs">
            <div>
              <p className="font-bold text-blue-900">{selectedAsnForSubmissions?.subjectCode} — {selectedAsnForSubmissions?.title}</p>
              <p className="text-blue-700 mt-0.5">Due: {selectedAsnForSubmissions?.dueDate ? new Date(selectedAsnForSubmissions.dueDate).toLocaleString() : ''} · Max Marks: {selectedAsnForSubmissions?.maxMarks}</p>
            </div>
            <span className="font-extrabold text-blue-900 bg-white px-3 py-1 rounded-lg border border-blue-200">
              Total Submissions: {submissionsList.length}
            </span>
          </div>

          {submissionsLoading ? (
            <div className="p-8 text-center"><span className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>
          ) : submissionsList.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-xs font-semibold">No student submissions received for this assignment yet.</div>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="th">Student Name</th>
                    <th className="th">Roll Number</th>
                    <th className="th">Submitted At</th>
                    <th className="th">Status</th>
                    <th className="th">Marks</th>
                    <th className="th">Feedback</th>
                    <th className="th text-right">Grade Action</th>
                  </tr>
                </thead>
                <tbody>
                  {submissionsList.map(sub => (
                    <tr key={sub.id} className="tr-hover">
                      <td className="td font-bold text-gray-900">{sub.student?.name}</td>
                      <td className="td font-mono text-xs">{sub.student?.roll}</td>
                      <td className="td text-xs text-gray-500 whitespace-nowrap">
                        {new Date(sub.submittedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="td">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                          sub.status === 'GRADED' ? 'bg-green-50 text-green-700 border-green-200' :
                          sub.status === 'LATE' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {sub.status}
                        </span>
                      </td>
                      <td className="td font-bold text-gray-900">
                        {sub.marks !== null && sub.marks !== undefined ? `${sub.marks} / ${selectedAsnForSubmissions.maxMarks}` : '—'}
                      </td>
                      <td className="td text-xs text-gray-500 truncate max-w-xs">{sub.feedback || '—'}</td>
                      <td className="td text-right">
                        {isWriteAllowed ? (
                          <button onClick={() => handleOpenGrading(sub)} className="btn-primary py-1 px-2.5 text-xs">
                            {sub.marks !== null ? 'Re-Grade' : 'Grade Student'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL: GRADE SUBMISSION */}
      <Modal isOpen={!!selectedSubForGrading} onClose={() => setSelectedSubForGrading(null)} title={`Grade Student: ${selectedSubForGrading?.student?.name}`}>
        <form onSubmit={handleGradeSubmit} className="space-y-4">
          <div className="bg-gray-50 p-3 rounded-xl text-xs space-y-1">
            <p><span className="font-bold text-gray-700">Student:</span> {selectedSubForGrading?.student?.name} ({selectedSubForGrading?.student?.roll})</p>
            <p><span className="font-bold text-gray-700">Assignment:</span> {selectedAsnForSubmissions?.title}</p>
            <p><span className="font-bold text-gray-700">Max Marks Allowed:</span> {selectedAsnForSubmissions?.maxMarks}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Enter Marks (0 - {selectedAsnForSubmissions?.maxMarks}) *</label>
            <input
              type="number"
              className="input-field"
              value={gradeForm.marks}
              onChange={e => setGradeForm({ ...gradeForm, marks: e.target.value })}
              min={0}
              max={selectedAsnForSubmissions?.maxMarks || 100}
              step="any"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Feedback / Comments for Student</label>
            <textarea
              className="input-field h-20 resize-none"
              value={gradeForm.feedback}
              onChange={e => setGradeForm({ ...gradeForm, feedback: e.target.value })}
              placeholder="e.g. Excellent work on SQL queries! Pay attention to indexing."
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setSelectedSubForGrading(null)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={gradeSaving}>
              {gradeSaving ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Save Grade &amp; Notify Student'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CREATE STUDY MATERIAL */}
      <Modal isOpen={isMatModalOpen} onClose={() => setIsMatModalOpen(false)} title="Upload Study Material">
        <form onSubmit={handleCreateMaterial} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
            <input className="input-field" value={matForm.title} onChange={e => setMatForm({ ...matForm, title: e.target.value })} placeholder="e.g. Chapter 4: Normalization Notes" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Category</label>
              <select className="input-field" value={matForm.category} onChange={e => setMatForm({ ...matForm, category: e.target.value })}>
                <option value="LECTURE_NOTE">Lecture Note</option>
                <option value="PDF">PDF Document</option>
                <option value="PPT">PPT Presentation</option>
                <option value="DOCUMENT">Word Document</option>
                <option value="LINK">External Resource Link</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Course / Subject</label>
              <select className="input-field" value={matForm.subjectId} onChange={e => setMatForm({ ...matForm, subjectId: e.target.value })}>
                <option value="">-- Select Subject --</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.code}: {c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <TargetingSelector 
            value={matForm} 
            onChange={newT => setMatForm(p => ({ ...p, ...newT }))} 
          />
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description / Summary</label>
            <textarea className="input-field h-20 resize-none" value={matForm.description} onChange={e => setMatForm({ ...matForm, description: e.target.value })} placeholder="Short description of this material…" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Resource / Document Link</label>
            <input type="url" className="input-field" value={matForm.fileUrl} onChange={e => setMatForm({ ...matForm, fileUrl: e.target.value })} placeholder="https://drive.google.com/..." />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setIsMatModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={matSaving}>
              {matSaving ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Publish Material'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
