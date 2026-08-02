/**
 * Academic Results Module V2 - Unified Frontend UI Engine
 * 
 * Renders the single source-of-truth Academic Summary Widget on Dashboard & Results screens.
 */

window.AcademicV2 = (() => {
    /**
     * Render Academic GPA Summary Widget (Unified for Dashboard & Results)
     * @param {HTMLElement|string} container 
     * @param {Object} data 
     */
    function renderAcademicSummary(container, data) {
        const target = typeof container === 'string' ? document.getElementById(container) : container;
        if (!target) return;

        const rawData = data || {};
        const overall = rawData.overall || {};
        const semesters = rawData.semesters || [];

        const cgpa = overall.cgpa || rawData.cgpa || (semesters[0]?.cgpa) || '--';
        const sgpa = (rawData.sgpa && rawData.sgpa !== 'N/A' && rawData.sgpa !== '--')
            ? rawData.sgpa
            : (semesters.length > 0 ? (semesters[semesters.length - 1]?.sgpa || semesters[0]?.sgpa || '--') : '--');
        const percentage = overall.percentage || rawData.percentage || '--';
        const totalCredits = overall.totalCredits || rawData.totalCredits || (semesters.reduce((acc, s) => acc + (parseFloat(s.creditsEarned || s.credits) || 0), 0) || '--');
        const status = overall.status || rawData.status || 'PASS';

        const lastSync = rawData.lastSync || rawData.updatedAt || rawData.lastSynced || null;
        let lastSyncText = '';
        if (lastSync) {
            try {
                const date = new Date(lastSync);
                lastSyncText = date.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
            } catch (e) {
                lastSyncText = String(lastSync);
            }
        }

        target.innerHTML = `
            <div class="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden transition-all duration-300 hover:shadow-xl">
                <div class="absolute -right-6 -bottom-6 opacity-10 text-white pointer-events-none">
                    <svg class="w-36 h-36" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
                    </svg>
                </div>
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <span class="text-xs uppercase tracking-wider font-semibold text-blue-200">Academic GPA Overview</span>
                        <h3 class="text-lg font-bold">Performance Summary</h3>
                    </div>
                    <span class="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold text-white">
                        ${status}
                    </span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
                    <div>
                        <div class="text-xs text-blue-200 font-medium mb-1">Overall CGPA</div>
                        <div class="text-2xl font-black tracking-tight" id="v2-dash-cgpa">${cgpa}</div>
                    </div>
                    <div class="border-l border-white/10 sm:border-x">
                        <div class="text-xs text-blue-200 font-medium mb-1">Current SGPA</div>
                        <div class="text-2xl font-black tracking-tight" id="v2-dash-sgpa">${sgpa}</div>
                    </div>
                    <div class="border-t sm:border-t-0 border-r border-white/10 pt-2 sm:pt-0">
                        <div class="text-xs text-blue-200 font-medium mb-1">Percentage</div>
                        <div class="text-xl font-bold tracking-tight mt-0.5">${percentage}</div>
                    </div>
                    <div class="border-t sm:border-t-0 border-white/10 pt-2 sm:pt-0">
                        <div class="text-xs text-blue-200 font-medium mb-1">Total Credits</div>
                        <div class="text-xl font-bold tracking-tight mt-0.5">${totalCredits}</div>
                    </div>
                </div>
                ${lastSyncText ? `<div class="mt-3 text-[10px] text-blue-200/80 text-right font-medium">Last Updated: ${lastSyncText}</div>` : ''}
            </div>
        `;
    }

    return {
        renderAcademicSummary,
        renderDashboardCard: renderAcademicSummary,
        renderResultsScreen: renderAcademicSummary
    };
})();

