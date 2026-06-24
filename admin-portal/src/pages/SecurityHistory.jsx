import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export default function SecurityHistory() {
  const [passes, setPasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = () => {
    setLoading(true);
    api.get('/admin/exit-passes')
      .then(res => {
        setPasses(res.data);
      })
      .catch(() => setError('Failed to retrieve verification history.'))
      .finally(() => setLoading(false));
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'USED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold border border-gray-200">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
            Used (Out)
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-150 text-green-700 text-xs font-semibold border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            Approved
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
            Rejected
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Expired
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            {status}
          </span>
        );
    }
  };

  const filteredPasses = passes.filter(pass => {
    const matchesSearch = 
      (pass.student?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (pass.student?.roll || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (pass.destination || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL' || pass.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Verification History</h2>
          <p className="text-sm text-gray-500 mt-1">Audit logs of all exit passes and gate verification events.</p>
        </div>
        <button
          onClick={fetchHistory}
          className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-xs font-bold bg-white"
        >
          <span className="material-symbols-outlined text-sm">sync</span>
          Refresh Log
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 border border-gray-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">search</span>
          <input
            type="text"
            placeholder="Search by student, roll number, or destination..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-250 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-xs text-gray-800 placeholder-gray-400"
          />
        </div>

        {/* Status filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {['ALL', 'USED', 'APPROVED', 'REJECTED', 'EXPIRED'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-xl font-semibold text-xs transition-all ${
                statusFilter === status
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-150 border border-gray-100 hover:text-gray-700'
              }`}
            >
              {status === 'ALL' ? 'All Logs' : status}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 bg-white border border-gray-200 rounded-2xl">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Student Details</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Roll Number</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Reason & Destination</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Exit Date</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Approved By</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Verified By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredPasses.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-16 text-sm text-gray-500">
                      <span className="material-symbols-outlined text-[36px] text-gray-300 block mb-2">assignment_late</span>
                      No matching exit pass records found.
                    </td>
                  </tr>
                ) : (
                  filteredPasses.map((pass) => (
                    <tr key={pass.id} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-xs">
                            {pass.student?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ST'}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-gray-800 block">{pass.student?.name}</span>
                            <span className="text-[10px] text-gray-400">{pass.student?.phone || 'No phone'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-500">{pass.student?.roll}</td>
                      <td className="px-6 py-4 max-w-xs">
                        <span className="text-xs text-gray-700 block truncate font-medium" title={pass.destination}>To: {pass.destination}</span>
                        <span className="text-[10px] text-gray-400 block truncate" title={pass.reason}>{pass.reason}</span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        <span className="block font-medium text-gray-700">{pass.requestedDate}</span>
                        {pass.verifiedAt && (
                          <span className="text-[10px] text-gray-400 block">
                            Out: {new Date(pass.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(pass.status)}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        <span className="font-medium">{pass.approvedBy ? pass.approvedBy.split('@')[0] : 'System'}</span>
                        <span className="block text-[9px] text-gray-400">{pass.approvedBy || 'automated'}</span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        {pass.verifiedBy ? (
                          <>
                            <span className="font-medium text-blue-700">{pass.verifiedBy.split('@')[0]}</span>
                            <span className="block text-[9px] text-blue-500">{pass.verifiedBy}</span>
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
      )}
    </div>
  );
}
