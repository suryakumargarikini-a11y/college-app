/**
 * Academic Results Module V2 - Frontend UI Engine
 * 
 * Renders the interactive Dashboard Academic GPA Summary Widget.
 */

window.AcademicV2 = (() => {
    /**
     * Render Dashboard Academic GPA Summary Widget (Clickable -> Navigates to /marks)
     * @param {HTMLElement|string} container 
     * @param {Object} data 
     */
    function renderDashboardCard(container, data) {
        const target = typeof container === 'string' ? document.getElementById(container) : container;
        if (!target) return;

        const overall = data.overall || {};
        const cgpa = overall.cgpa || data.cgpa || '--';
        const sgpa = overall.sgpa || data.sgpa || '--';
        const percentage = overall.percentage || data.percentage || '--';

        target.innerHTML = `
            <div onclick="haptic(); router.navigate('/marks')" class="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden transition-all duration-300 hover:shadow-xl cursor-pointer active:scale-[0.98]">
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
                    <span class="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold text-white flex items-center gap-1">
                        <span>Details</span>
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                        </svg>
                    </span>
                </div>
                <div class="grid grid-cols-3 gap-3 text-center bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
                    <div>
                        <div class="text-xs text-blue-200 font-medium mb-1">Overall CGPA</div>
                        <div class="text-2xl font-black tracking-tight" id="v2-dash-cgpa">${cgpa}</div>
                    </div>
                    <div class="border-x border-white/10">
                        <div class="text-xs text-blue-200 font-medium mb-1">Current SGPA</div>
                        <div class="text-2xl font-black tracking-tight" id="v2-dash-sgpa">${sgpa}</div>
                    </div>
                    <div>
                        <div class="text-xs text-blue-200 font-medium mb-1">Percentage</div>
                        <div class="text-xl font-bold tracking-tight mt-0.5">${percentage}</div>
                    </div>
                </div>
            </div>
        `;
    }

    return {
        renderDashboardCard
    };
})();

