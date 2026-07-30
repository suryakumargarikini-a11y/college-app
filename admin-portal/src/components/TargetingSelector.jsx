import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';

/**
 * Reusable 4-field Cascading Dropdown Component for Student Access Targeting.
 * Cascading hierarchy: Branch * -> Year * -> Semester * -> Section *
 * All values populated dynamically from real Student DB records via API.
 */
export default function TargetingSelector({ value = {}, onChange, disabled = false }) {
  const [audienceTree, setAudienceTree] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch real student audience options from backend
  useEffect(() => {
    let isMounted = true;
    api.get('/admin/lms/audience-options')
      .then(res => {
        if (isMounted && res.data && Array.isArray(res.data.branches)) {
          setAudienceTree(res.data.branches);
        }
      })
      .catch(() => {
        // Fallback fetch if LMS route is alternative
        api.get('/admin/notifications/audience-options')
          .then(res => {
            if (isMounted && res.data && Array.isArray(res.data.branches)) {
              setAudienceTree(res.data.branches);
            }
          })
          .catch(() => {});
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, []);

  // Standard fallback departments if tree loading or custom scope
  const fallbackBranches = useMemo(() => [
    { value: 'CSE', label: 'CSE (Computer Science & Engineering)', years: defaultYears() },
    { value: 'AIDS', label: 'AIDS (AI & Data Science)', years: defaultYears() },
    { value: 'AIML', label: 'AIML (AI & Machine Learning)', years: defaultYears() },
    { value: 'ECE', label: 'ECE (Electronics & Communication)', years: defaultYears() },
    { value: 'EEE', label: 'EEE (Electrical & Electronics)', years: defaultYears() },
    { value: 'IT', label: 'IT (Information Technology)', years: defaultYears() },
    { value: 'MECH', label: 'MECH (Mechanical Engineering)', years: defaultYears() },
    { value: 'CIVIL', label: 'CIVIL (Civil Engineering)', years: defaultYears() }
  ], []);

  function defaultYears() {
    return [
      { value: '1', label: '1st Year', semesters: [{ value: '1', label: 'Semester 1', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }, { value: '2', label: 'Semester 2', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }] },
      { value: '2', label: '2nd Year', semesters: [{ value: '3', label: 'Semester 3', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }, { value: '4', label: 'Semester 4', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }] },
      { value: '3', label: '3rd Year', semesters: [{ value: '5', label: 'Semester 5', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }, { value: '6', label: 'Semester 6', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }] },
      { value: '4', label: '4th Year', semesters: [{ value: '7', label: 'Semester 7', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }, { value: '8', label: 'Semester 8', sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }] }
    ];
  }

  // Active branches available for selection
  const branchOptions = useMemo(() => {
    if (audienceTree.length > 0) return audienceTree;
    return fallbackBranches;
  }, [audienceTree, fallbackBranches]);

  // Selected Branch object
  const selectedBranchObj = useMemo(() => {
    return branchOptions.find(b => b.value === value.branch || b.canonical === value.branch);
  }, [branchOptions, value.branch]);

  // Active years available for selected Branch
  const yearOptions = useMemo(() => {
    if (selectedBranchObj && Array.isArray(selectedBranchObj.years)) {
      return selectedBranchObj.years;
    }
    return defaultYears();
  }, [selectedBranchObj]);

  // Selected Year object
  const selectedYearObj = useMemo(() => {
    const normVal = String(value.year || '').replace(/[^0-9]/g, '');
    return yearOptions.find(y => y.value === value.year || y.value === normVal || y.label === value.year);
  }, [yearOptions, value.year]);

  // Active semesters available for selected Year
  const semOptions = useMemo(() => {
    if (selectedYearObj && Array.isArray(selectedYearObj.semesters)) {
      return selectedYearObj.semesters;
    }
    const yrNum = Number(String(value.year || '').replace(/[^0-9]/g, '')) || 1;
    const sem1 = (yrNum * 2) - 1;
    const sem2 = yrNum * 2;
    return [
      { value: String(sem1), label: `Semester ${sem1}`, sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] },
      { value: String(sem2), label: `Semester ${sem2}`, sections: [{ value: 'A', label: 'Section A' }, { value: 'B', label: 'Section B' }, { value: 'C', label: 'Section C' }] }
    ];
  }, [selectedYearObj, value.year]);

  // Selected Semester object
  const selectedSemObj = useMemo(() => {
    const normSem = String(value.semester || '').replace(/[^0-9]/g, '');
    return semOptions.find(s => s.value === value.semester || s.value === normSem);
  }, [semOptions, value.semester]);

  // Active sections available for selected Semester
  const sectionOptions = useMemo(() => {
    if (selectedSemObj && Array.isArray(selectedSemObj.sections)) {
      return selectedSemObj.sections;
    }
    return [
      { value: 'A', label: 'Section A' },
      { value: 'B', label: 'Section B' },
      { value: 'C', label: 'Section C' }
    ];
  }, [selectedSemObj]);

  // Cascading Handlers
  const handleBranchChange = (e) => {
    const newBranch = e.target.value;
    onChange({
      ...value,
      branch: newBranch,
      year: '',
      semester: '',
      section: ''
    });
  };

  const handleYearChange = (e) => {
    const newYear = e.target.value;
    onChange({
      ...value,
      year: newYear,
      semester: '',
      section: ''
    });
  };

  const handleSemesterChange = (e) => {
    const newSem = e.target.value;
    onChange({
      ...value,
      semester: newSem,
      section: ''
    });
  };

  const handleSectionChange = (e) => {
    const newSec = e.target.value;
    onChange({
      ...value,
      section: newSec
    });
  };

  return (
    <div className="border-t border-slate-100 my-3 pt-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider font-extrabold text-blue-600">Student Access Targeting</p>
        {loading && <span className="text-[10px] text-slate-400 font-medium">Loading options...</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* 1. Branch Dropdown */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Branch *</label>
          <select
            className="input-field bg-white"
            value={value.branch || ''}
            onChange={handleBranchChange}
            required
            disabled={disabled}
          >
            <option value="">-- Select Branch --</option>
            {branchOptions.map(b => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* 2. Year Dropdown (Study Year) */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Year *</label>
          <select
            className="input-field bg-white"
            value={value.year || ''}
            onChange={handleYearChange}
            required
            disabled={disabled || !value.branch}
          >
            <option value="">-- Select Year --</option>
            {yearOptions.map(y => (
              <option key={y.value} value={y.value}>{y.label}</option>
            ))}
          </select>
        </div>

        {/* 3. Semester Dropdown */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Semester *</label>
          <select
            className="input-field bg-white"
            value={value.semester || ''}
            onChange={handleSemesterChange}
            required
            disabled={disabled || !value.year}
          >
            <option value="">-- Select Semester --</option>
            {semOptions.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* 4. Section Dropdown */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Section *</label>
          <select
            className="input-field bg-white"
            value={value.section || ''}
            onChange={handleSectionChange}
            required
            disabled={disabled || !value.semester}
          >
            <option value="">-- Select Section --</option>
            {sectionOptions.map(sec => (
              <option key={sec.value} value={sec.value}>{sec.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
