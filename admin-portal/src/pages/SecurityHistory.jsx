import React, { useEffect, useState, useMemo, useCallback } from 'react';
import api from '../lib/api';
import Badge from '../components/Badge';
import SearchInput from '../components/SearchInput';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';

const STATUS_FILTERS = ['ALL', 'USED', 'APPROVED', 'REJECTED', 'EXPIRED'];

function SkeletonRows({ n = 5 }) {
  return [...Array(n)].map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="skeleton w-8 h-8 rounded-full" /><div className="skeleton h-3 w-32 rounded" /></div></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-36 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-24 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-16 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
    </tr>
  ));
}

export default function SecurityHistory() {
  const [passes,       setPasses]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fetchHistory = useCallback(() => {
    setLoading(true);
    api.get('/admin/exit-passes')
      .then(res => setPasses(res.data))
      .catch(() => setError('Failed to retrieve verification history.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filtered = useMemo(() => {
    return passes.filter(p => {
      const matchSearch =
        !search ||
        (p.student?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.student?.roll || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.destination || '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || p.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [passes, search, statusFilter]);

  return (
    <div className="space-y-5 select-none fade-in">
      <PageHeader
        title="Verification History"
        subtitle="Audit logs of all exit passes and gate verification events"
        actions={
          <button onClick={fetchHistory} className="btn-secondary">
            <span className="material-symbols-outlined text-[17px]">sync</span>
            Refresh Log
          </button>
        }
      />

      {/* Filters */}
      <div className="card p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by student, roll number, or destination…" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === s ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
              }`}
            >
              {s === 'ALL' ? 'All Logs' : s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="th">Student</th>
                <th className="th">Roll</th>
                <th className="th">Reason &amp; Destination</th>
                <th className="th">Exit Date</th>
                <th className="th">Status</th>
                <th className="th">Approved By</th>
                <th className="th">Verified By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <EmptyState icon="assignment_late" title="No matching records" description={search || statusFilter !== 'ALL' ? 'Try adjusting your search or filter.' : 'No exit pass history available yet.'} />
                  </td>
                </tr>
              ) : (
                filtered.map(pass => (
                  <tr key={pass.id} className="tr-hover">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center font-bold text-xs flex-shrink-0">
                          {pass.student?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ST'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{pass.student?.name}</p>
                          <p className="text-[11px] text-gray-400">{pass.student?.phone || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="td text-xs font-mono text-gray-500">{pass.student?.roll}</td>
                    <td className="td max-w-[180px]">
                      <p className="text-xs font-medium text-gray-700 truncate" title={pass.destination}>To: {pass.destination}</p>
                      <p className="text-[11px] text-gray-400 truncate" title={pass.reason}>{pass.reason}</p>
                    </td>
                    <td className="td text-xs text-gray-500 whitespace-nowrap">
                      <p className="font-medium text-gray-700">{pass.requestedDate}</p>
                      {pass.verifiedAt && <p className="text-[10px] text-gray-400">Out: {new Date(pass.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                    </td>
                    <td className="td"><Badge value={pass.status} /></td>
                    <td className="td text-xs text-gray-500">
                      <p className="font-medium">{pass.approvedBy ? pass.approvedBy.split('@')[0] : 'System'}</p>
                      <p className="text-[10px] text-gray-400">{pass.approvedBy || '—'}</p>
                    </td>
                    <td className="td text-xs">
                      {pass.verifiedBy ? (
                        <>
                          <p className="font-semibold text-blue-700">{pass.verifiedBy.split('@')[0]}</p>
                          <p className="text-[10px] text-blue-400">{pass.verifiedBy}</p>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 text-right">Showing {filtered.length} of {passes.length} records</p>
      )}
    </div>
  );
}
