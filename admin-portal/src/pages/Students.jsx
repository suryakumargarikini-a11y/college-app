import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function avatar(name) {
  const words = (name || '??').trim().split(/\s+/);
  const initials = words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : (name || '??').slice(0, 2).toUpperCase();
  const COLORS = ['bg-blue-600','bg-violet-600','bg-emerald-600','bg-rose-500','bg-amber-500','bg-indigo-600','bg-teal-600'];
  const idx = name ? name.charCodeAt(0) % COLORS.length : 0;
  return { initials, colorClass: COLORS[idx] };
}

function attColor(pct) {
  if (pct >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (pct >= 75) return 'text-blue-600 bg-blue-50 border-blue-200';
  if (pct >= 65) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

function Badge({ label, cls }) {
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>{label}</span>;
}

/* ── Drawer detail panel ──────────────────────────────────────────────────── */
function StudentDrawer({ student, onClose }) {
  const [detail, setDetail]   = useState(null);
  const [tab, setTab]         = useState('profile');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student) return;
    setTab('profile');
    setLoading(true);
    api.get(`/admin/students/${student.id}/detail`)
      .then(r => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [student?.id]);

  if (!student) return null;
  const { initials, colorClass } = avatar(student.name);
  const TABS = ['profile', 'academics', 'attendance', 'fees', 'marks', 'activity'];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-[520px] bg-white z-50 shadow-2xl flex flex-col overflow-hidden slide-up">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-5 text-white flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl ${colorClass} flex items-center justify-center text-white text-xl font-black flex-shrink-0 shadow-lg`}>
                {initials}
              </div>
              <div>
                <h3 className="font-black text-base leading-tight">{student.name}</h3>
                <p className="text-xs opacity-80">{student.roll}</p>
                <div className="flex gap-2 mt-1.5">
                  <span className="px-2 py-0.5 bg-white/20 rounded text-[10px] font-semibold">{student.branch}</span>
                  <span className="px-2 py-0.5 bg-white/20 rounded text-[10px] font-semibold">Year {student.year}</span>
                  <span className="px-2 py-0.5 bg-white/20 rounded text-[10px] font-semibold">Sec {student.section}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          {/* Quick KPIs */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: 'CGPA',      value: parseFloat(student.cgpa || 0).toFixed(2) },
              { label: 'Attendance',value: `${(student.avgPct || 0).toFixed(1)}%`  },
              { label: 'Fee Due',   value: `₹${(student.feesDue || 0).toLocaleString('en-IN')}` },
            ].map(k => (
              <div key={k.label} className="bg-white/15 rounded-lg p-2 text-center">
                <p className="text-[9px] font-bold uppercase opacity-70">{k.label}</p>
                <p className="text-sm font-black">{k.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b flex overflow-x-auto flex-shrink-0 bg-gray-50">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold capitalize whitespace-nowrap border-b-2 transition-colors ${
                tab === t ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="space-y-2">{Array.from({length:6}).map((_,i)=><div key={i} className="skeleton h-10 rounded-xl"/>)}</div>}
          {!loading && tab === 'profile' && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              {[
                ['Email',       student.email],
                ['Phone',       student.phone],
                ['DOB',         student.dob],
                ['Blood Group', student.bloodGroup],
                ['Admission No',student.admissionNo],
                ['Program',     student.program],
                ['Section',     student.section],
                ['Hostel',      student.hostel || 'Day Scholar'],
                ['Room No',     student.roomNo || '—'],
                ['Father',      student.fatherName],
                ['Mother',      student.motherName],
                ['Guardian Ph', student.guardianPhone || student.fatherMobile || '—'],
                ['SSC Marks',   student.sscMarks ? `${student.sscMarks}%` : '—'],
                ['Inter Marks', student.interMarks ? `${student.interMarks}%` : '—'],
                ['Scholarship', student.scholarship || 'None'],
                ['Seat Type',   student.seatType || '—'],
                ['Entrance',    student.entranceType || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] font-bold text-gray-400 uppercase">{k}</dt>
                  <dd className="font-semibold text-gray-800 mt-0.5 truncate">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          {!loading && tab === 'academics' && detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
                  <p className="text-[10px] font-bold text-blue-400 uppercase">CGPA</p>
                  <p className="text-2xl font-black text-blue-700">{parseFloat(student.cgpa||0).toFixed(2)}</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center border border-amber-100">
                  <p className="text-[10px] font-bold text-amber-400 uppercase">Backlogs</p>
                  <p className="text-2xl font-black text-amber-700">{student.backlogCount || 0}</p>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border">
                <p className="text-xs font-bold text-gray-600 mb-2">Placement Status</p>
                <Badge label={student.placementStatus || 'N/A'}
                  cls={student.placementStatus === 'Placed' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-gray-600 bg-gray-100 border-gray-200'} />
              </div>
            </div>
          )}
          {!loading && tab === 'attendance' && detail && (
            <div className="space-y-2">
              {(detail.attendance || []).map((a, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{a.subjectName || a.subject}</p>
                    <p className="text-[10px] text-gray-400">{a.present}/{a.total} classes</p>
                  </div>
                  <div className="flex-shrink-0">
                    <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${a.percentage >= 75 ? 'bg-emerald-500' : a.percentage >= 65 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, a.percentage)}%` }} />
                    </div>
                    <p className={`text-[10px] font-black text-right mt-0.5 ${a.percentage >= 75 ? 'text-emerald-600' : a.percentage >= 65 ? 'text-amber-600' : 'text-red-600'}`}>
                      {a.percentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
              {(detail.attendance || []).length === 0 && <p className="text-xs text-gray-400 text-center py-6">No attendance records</p>}
            </div>
          )}
          {!loading && tab === 'fees' && detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label:'Total',   value:`₹${(detail.fees?.totalAmount||0).toLocaleString('en-IN')}`, cls:'bg-gray-50' },
                  { label:'Paid',    value:`₹${(detail.fees?.paidAmount||0).toLocaleString('en-IN')}`,  cls:'bg-emerald-50' },
                  { label:'Due',     value:`₹${(detail.fees?.dueAmount||0).toLocaleString('en-IN')}`,   cls:detail.fees?.dueAmount > 0 ? 'bg-red-50' : 'bg-gray-50' },
                ].map(k => (
                  <div key={k.label} className={`${k.cls} rounded-xl p-3 text-center border border-gray-200`}>
                    <p className="text-[9px] font-bold text-gray-400 uppercase">{k.label}</p>
                    <p className="text-sm font-black text-gray-800 mt-0.5">{k.value}</p>
                  </div>
                ))}
              </div>
              {(detail.fees?.transactions || []).map((t, i) => (
                <div key={i} className="flex justify-between items-center py-2.5 border-b last:border-0">
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{t.title}</p>
                    <p className="text-[10px] text-gray-400">{t.dueDate || '—'} · Ref: {t.ref}</p>
                  </div>
                  <Badge label={t.status}
                    cls={t.status==='Paid'||t.status==='Completed' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      : t.status==='Partial' ? 'text-amber-700 bg-amber-50 border-amber-200'
                      : 'text-red-700 bg-red-50 border-red-200'} />
                </div>
              ))}
            </div>
          )}
          {!loading && tab === 'marks' && detail && (
            <div className="space-y-2">
              {(detail.marks || []).map((m, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{m.subject}</p>
                    <p className="text-[10px] text-gray-400">{m.code} · {m.credits} Credits</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge label={m.grade}
                      cls={m.status === 'Fail' || m.status === 'Backlog'
                        ? 'text-red-700 bg-red-50 border-red-200'
                        : 'text-emerald-700 bg-emerald-50 border-emerald-200'} />
                  </div>
                </div>
              ))}
              {(detail.marks || []).length === 0 && <p className="text-xs text-gray-400 text-center py-6">No mark records</p>}
            </div>
          )}
          {!loading && tab === 'activity' && detail && (
            <div className="space-y-3">
              {(detail.notifications || []).map((n, i) => (
                <div key={i} className="flex gap-3 p-2.5 rounded-xl bg-gray-50 border">
                  <span className="material-symbols-outlined text-[18px] text-blue-500 flex-shrink-0">notifications</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
              {(detail.notifications || []).length === 0 && <p className="text-xs text-gray-400 text-center py-6">No notifications</p>}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t flex gap-2 flex-shrink-0 bg-gray-50">
          <a href={`mailto:${student.email}`} className="btn-secondary flex-1 text-xs text-center flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">mail</span> Email
          </a>
          <a href={`tel:${student.phone}`} className="btn-secondary flex-1 text-xs text-center flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">call</span> Call
          </a>
        </div>
      </div>
    </>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */
const ITEMS_PER_PAGE = 25;

export default function Students() {
  const [students, setStudents] = useState([]);
  const [summary, setSummary]   = useState({});
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);

  const [filters, setFilters] = useState({
    search: '', branch: '', year: '', semester: '',
    section: '', hostel: '', feeStatus: '', attRisk: '', placement: ''
  });
  const [page, setPage]       = useState(1);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir]     = useState('asc');
  const searchTimer = useRef(null);

  const load = useCallback(async (f = filters, p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: ITEMS_PER_PAGE, ...f });
      const res = await api.get(`/admin/students?${params}`);
      setStudents(res.data.students || []);
      setPagination(res.data.pagination || {});
      setSummary(res.data.summary || {});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { load(filters, page); }, [page]);
  useEffect(() => { setPage(1); load(filters, 1); }, [JSON.stringify(filters)]);

  const setFilter = (key, val) => setFilters(prev => ({ ...prev, [key]: val }));
  const clearFilters = () => { setFilters({ search:'',branch:'',year:'',semester:'',section:'',hostel:'',feeStatus:'',attRisk:'',placement:'' }); setPage(1); };

  // client-side sort of current page
  const sorted = [...students].sort((a, b) => {
    let av = a[sortField]; let bv = b[sortField];
    if (sortField === 'avgPct' || sortField === 'cgpa' || sortField === 'feesDue') {
      av = parseFloat(av) || 0; bv = parseFloat(bv) || 0;
    }
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const exportCSV = () => {
    const rows = [['Name','Roll','Branch','Year','Semester','CGPA','Attendance%','Fees Due','Placement','Hostel','Email','Phone']];
    students.forEach(s => rows.push([s.name,s.roll,s.branch,s.year,s.semester,s.cgpa,s.avgPct,s.feesDue,s.placementStatus,s.hostel||'Day Scholar',s.email,s.phone]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `SITAM_Students_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  const BRANCHES = ['CSE','ECE','IT','MECH','CIVIL','EEE','AIML'];
  const YEARS    = ['1','2','3','4'];
  const SEMS     = ['1','2','3','4','5','6','7','8'];
  const SECS     = ['A','B','C','D'];

  return (
    <div className="space-y-5 fade-in">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-xl font-black text-gray-900">Student Registry</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${pagination.total.toLocaleString('en-IN')} students across ${summary.avgCgpa ? `Avg CGPA ${summary.avgCgpa}` : 'all departments'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5">
            <span className="material-symbols-outlined text-[15px]">download</span> Export CSV
          </button>
          <button onClick={() => load(filters, page)} className="btn-icon" title="Refresh">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </div>

      {/* ── Summary KPI row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Students',  value: (summary.total || 0).toLocaleString(),         cls: 'from-blue-50 to-blue-100 text-blue-700' },
          { label: 'Avg CGPA',        value: summary.avgCgpa || '—',                         cls: 'from-amber-50 to-yellow-100 text-amber-700' },
          { label: 'Avg Attendance',  value: `${summary.avgAttendance || 0}%`,               cls: 'from-emerald-50 to-green-100 text-emerald-700' },
          { label: 'Hostellers',      value: (summary.hostellers || 0).toLocaleString(),     cls: 'from-violet-50 to-purple-100 text-violet-700' },
          { label: 'Day Scholars',    value: (summary.dayScholars || 0).toLocaleString(),    cls: 'from-indigo-50 to-blue-100 text-indigo-700' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl p-3 bg-gradient-to-br ${k.cls} border border-white/60`}>
            <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{k.label}</p>
            <p className="text-lg font-black">{k.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-gray-400">search</span>
          <input
            type="text" placeholder="Search by name, roll number, email, or admission no…"
            value={filters.search}
            onChange={e => {
              const v = e.target.value;
              setFilter('search', v);
              if (searchTimer.current) clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => {}, 300);
            }}
            className="input-field pl-9 py-2 w-full text-sm"
          />
        </div>
        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'branch',    label: 'Branch',    opts: ['', ...BRANCHES],                         labels: ['All Branches', ...BRANCHES] },
            { key: 'year',      label: 'Year',      opts: ['', ...YEARS],                            labels: ['All Years', ...YEARS.map(y=>`Year ${y}`)] },
            { key: 'semester',  label: 'Semester',  opts: ['', ...SEMS],                             labels: ['All Sem', ...SEMS.map(s=>`Sem ${s}`)] },
            { key: 'section',   label: 'Section',   opts: ['', ...SECS],                             labels: ['All Sec', ...SECS.map(s=>`Sec ${s}`)] },
            { key: 'hostel',    label: 'Hostel',    opts: ['', 'yes', 'no'],                         labels: ['All', 'Hostellers', 'Day Scholars'] },
            { key: 'feeStatus', label: 'Fee',       opts: ['', 'PAID', 'UNPAID', 'PARTIAL'],         labels: ['All Fee', 'Paid', 'Unpaid', 'Partial'] },
            { key: 'attRisk',   label: 'Attendance',opts: ['', 'SAFE', 'RISK', 'CRITICAL'],          labels: ['All', 'Safe (≥75%)', 'At Risk (<75%)', 'Critical (<65%)'] },
            { key: 'placement', label: 'Placement', opts: ['', 'Placed', 'Not Placed'],              labels: ['All', 'Placed', 'Not Placed'] },
          ].map(f => (
            <select key={f.key} value={filters[f.key]}
              onChange={e => setFilter(f.key, e.target.value)}
              className="text-xs rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 font-medium text-gray-700 focus:outline-none focus:border-blue-500">
              {f.opts.map((o, i) => <option key={o} value={o}>{f.labels[i]}</option>)}
            </select>
          ))}
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-red-500 transition-colors flex items-center gap-1 px-2">
            <span className="material-symbols-outlined text-[14px]">filter_list_off</span> Clear
          </button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {[
                  { key: 'name',     label: 'Student' },
                  { key: 'branch',   label: 'Branch'  },
                  { key: 'year',     label: 'Year/Sem' },
                  { key: 'cgpa',     label: 'CGPA'    },
                  { key: 'avgPct',   label: 'Attend%'  },
                  { key: 'feesDue',  label: 'Fee Due'  },
                  { key: 'backlogCount', label: 'Backlogs' },
                  { key: 'placementStatus', label: 'Placement' },
                  { key: 'hostel',   label: 'Hostel'  },
                ].map(col => (
                  <th key={col.key}
                    onClick={() => { setSortField(col.key); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}
                    className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 whitespace-nowrap">
                    {col.label}
                    {sortField === col.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading && Array.from({length:8}).map((_,i)=>(
                <tr key={i}><td colSpan={10}><div className="skeleton h-10 mx-4 my-2 rounded" /></td></tr>
              ))}
              {!loading && sorted.map(s => {
                const { initials, colorClass } = avatar(s.name);
                return (
                  <tr key={s.id}
                    onClick={() => setSelected(s)}
                    className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${
                      s.avgPct < 65 ? 'bg-red-50/20' : s.feesDue > 0 ? 'bg-amber-50/20' : ''
                    }`}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center text-white text-[11px] font-black flex-shrink-0`}>
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate max-w-[140px]">{s.name}</p>
                          <p className="text-[10px] text-gray-400">{s.roll}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-bold">{s.branch}</span></td>
                    <td className="px-4 py-2 text-xs text-gray-600">Y{s.year} / S{s.semester}</td>
                    <td className="px-4 py-2">
                      <span className={`font-bold text-sm ${parseFloat(s.cgpa) >= 8 ? 'text-emerald-600' : parseFloat(s.cgpa) >= 6 ? 'text-blue-600' : 'text-red-600'}`}>
                        {parseFloat(s.cgpa || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge label={`${s.avgPct.toFixed(1)}%`} cls={attColor(s.avgPct)} />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {s.feesDue > 0
                        ? <span className="text-red-600 font-bold">₹{s.feesDue.toLocaleString('en-IN')}</span>
                        : <span className="text-emerald-600 font-bold">Paid</span>}
                    </td>
                    <td className="px-4 py-2">
                      {s.backlogCount > 0
                        ? <span className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full text-[10px] font-bold">{s.backlogCount}</span>
                        : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <Badge label={s.placementStatus}
                        cls={s.placementStatus === 'Placed'
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : 'text-gray-600 bg-gray-100 border-gray-200'} />
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {(s.hostel||'').toLowerCase() === 'yes' ? 'Hostel' : 'Day Scholar'}
                    </td>
                    <td className="px-4 py-2">
                      <button className="btn-icon text-[14px]" onClick={e => { e.stopPropagation(); setSelected(s); }}>
                        <span className="material-symbols-outlined">chevron_right</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && sorted.length === 0 && (
                <tr><td colSpan={10} className="py-12 text-center text-sm text-gray-400">
                  <span className="material-symbols-outlined text-3xl block mb-2">search_off</span>
                  No students match the current filters
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              Showing {((pagination.page - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(pagination.page * ITEMS_PER_PAGE, pagination.total)} of {pagination.total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(1)}
                className="btn-icon text-[14px] disabled:opacity-30">
                <span className="material-symbols-outlined">first_page</span>
              </button>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="btn-icon text-[14px] disabled:opacity-30">
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              {Array.from({length: Math.min(5, pagination.totalPages)}, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, pagination.totalPages - 4));
                const n = start + i;
                return (
                  <button key={n} onClick={() => setPage(n)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                      n === page ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}>{n}</button>
                );
              })}
              <button disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}
                className="btn-icon text-[14px] disabled:opacity-30">
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <button disabled={page >= pagination.totalPages} onClick={() => setPage(pagination.totalPages)}
                className="btn-icon text-[14px] disabled:opacity-30">
                <span className="material-symbols-outlined">last_page</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Drawer */}
      <StudentDrawer student={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
