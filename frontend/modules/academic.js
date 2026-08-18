/**
 * Academic Results Module V2 - Frontend UI Engine
 * 
 * Renders the interactive Dashboard Overall SGPA Summary Widget.
 */

window.AcademicV2 = (() => {
    /**
     * Helper to compute performance label and badge styles from SGPA number
     * @param {number|string} rawVal 
     */
    function getSgpaPerformanceInfo(rawVal) {
        if (rawVal === null || rawVal === undefined) {
            return { displayVal: '--', label: 'N/A', badgeClass: 'bg-slate-100 text-slate-500 border-slate-200' };
        }
        let num = null;
        if (typeof rawVal === 'number') {
            num = isNaN(rawVal) || rawVal <= 0 ? null : rawVal;
        } else if (typeof rawVal === 'string') {
            const cleaned = rawVal.trim().replace(/[^0-9.]/g, '');
            if (cleaned) {
                const parsed = parseFloat(cleaned);
                if (!isNaN(parsed) && parsed > 0 && parsed <= 10) {
                    num = parsed;
                }
            }
        }
        if (num === null) {
            return { displayVal: '--', label: 'N/A', badgeClass: 'bg-slate-100 text-slate-500 border-slate-200' };
        }

        const formattedVal = num.toFixed(2);
        let label = '';
        let badgeClass = '';

        if (num >= 9.00) {
            label = 'Excellent';
            badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        } else if (num >= 8.00) {
            label = 'Very Good';
            badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
        } else if (num >= 7.00) {
            label = 'Good';
            badgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
        } else if (num >= 6.00) {
            label = 'Average';
            badgeClass = 'bg-orange-50 text-orange-700 border-orange-200';
        } else {
            label = 'Needs Improvement';
            badgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
        }

        return { displayVal: formattedVal, label, badgeClass };
    }

    /**
     * Render Dashboard Overall SGPA / Cumulative GPA Widget.
     * Uses the SAME data extraction as the Academics page (marks/afterRender):
     *   Primary display value → overall.cgpa || data.cgpa  (cumulative GPA = true "overall" indicator)
     *   Semestral SGPA badge → latest semester's SGPA from the semesters array
     * @param {HTMLElement|string} container 
     * @param {Object} data  – already-unwrapped payload: { cgpa, sgpa, overall, semesters }
     */
    function renderDashboardCard(container, data) {
        const target = typeof container === 'string' ? document.getElementById(container) : container;
        if (!target) return;

        const overall = data?.overall || {};
        const sList = Array.isArray(data?.semesters) ? data.semesters : [];

        // --- Cumulative GPA: same source the Academics page CGPA ring uses ---
        // academic.js (marks/afterRender): const cgpa = parseFloat(overall?.cgpa || rawData.cgpa) || 0;
        const rawCgpa = overall?.cgpa || data?.cgpa;

        // --- Latest semester SGPA for the badge chip ---
        // academic.js (marks/renderHistory line 2847): rawData.sgpa || semList[0]?.sgpa
        let latestSgpa = data?.sgpa;
        if (!latestSgpa || latestSgpa === '--' || latestSgpa === 'N/A') {
            // Walk semesters newest-first to find a valid SGPA
            for (let i = sList.length - 1; i >= 0; i--) {
                const s = sList[i]?.sgpa;
                if (s && s !== '--' && s !== 'N/A' && !isNaN(parseFloat(s))) {
                    latestSgpa = s;
                    break;
                }
            }
        }

        const info = getSgpaPerformanceInfo(rawCgpa);

        // Format latest SGPA for the badge
        const latestSgpaNum = parseFloat(latestSgpa);
        const latestSgpaDisplay = (!isNaN(latestSgpaNum) && latestSgpaNum > 0)
            ? latestSgpaNum.toFixed(2)
            : '--';

        target.className = 'glass-card p-5 rounded-3xl flex flex-col justify-between h-40 border-l-4 border-l-amber-500 cursor-pointer hover:scale-[1.02] active-scale transition-all';
        target.setAttribute('onclick', "haptic(); router.navigate('/marks')");

        target.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h4 class="text-sm font-bold text-on-surface uppercase">OVERALL SGPA</h4>
                    <p class="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">CUMULATIVE PERFORMANCE</p>
                </div>
                <span class="material-symbols-outlined text-amber-500 text-2xl" style="font-variation-settings:'FILL' 1">stars</span>
            </div>
            <div class="flex justify-between items-end">
                <p class="text-3xl font-black text-slate-800 leading-none" id="dash-sgpa-val">${info.displayVal}</p>
                <div id="dash-sgpa-badge" class="text-right text-[9px] font-extrabold uppercase tracking-wide border px-2.5 py-0.5 rounded-full ${info.badgeClass}">
                    ${info.label}
                </div>
            </div>
        `;
    }

    return {
        renderDashboardCard,
        getSgpaPerformanceInfo
    };
})();

