/**
 * Academic Results Module V2 - Frontend UI Engine
 * 
 * Renders Dashboard Academic GPA card and Marks & Results Screen
 * with expandable semester accordion cards and detailed subject tables.
 */

window.AcademicV2 = (() => {
    /**
     * Render Dashboard Academic GPA Summary Widget
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
                        AY 2026-27
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

    /**
     * Render Marks & Results Screen (Summary + Accordion Semesters)
     * @param {HTMLElement|string} container 
     * @param {Object} data 
     */
    function renderResultsScreen(container, data) {
        const target = typeof container === 'string' ? document.getElementById(container) : container;
        if (!target) return;

        const overall = data.overall || {};
        const semesters = data.semesters || [];
        const cgpa = overall.cgpa || data.cgpa || '--';
        const sgpa = overall.sgpa || data.sgpa || '--';
        const totalCredits = overall.totalCredits || '--';

        let html = `
            <div class="space-y-6 pb-20">
                <!-- Academic Header Summary Card -->
                <div class="bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-xl border border-slate-800">
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center space-x-3">
                            <div class="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                                </svg>
                            </div>
                            <div>
                                <h2 class="text-xl font-bold">Academic Performance History</h2>
                                <p class="text-xs text-slate-400">SITAM ECAP Official ERP Verification</p>
                            </div>
                        </div>
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${overall.status === 'PASS' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400'}">
                            ${overall.status || 'PASS'}
                        </span>
                    </div>

                    <div class="grid grid-cols-3 gap-4 pt-2 border-t border-slate-800">
                        <div>
                            <div class="text-xs text-slate-400 mb-1">Cumulative CGPA</div>
                            <div class="text-2xl font-black text-indigo-400">${cgpa}</div>
                        </div>
                        <div>
                            <div class="text-xs text-slate-400 mb-1">Latest SGPA</div>
                            <div class="text-2xl font-black text-blue-400">${sgpa}</div>
                        </div>
                        <div>
                            <div class="text-xs text-slate-400 mb-1">Total Credits</div>
                            <div class="text-2xl font-black text-emerald-400">${totalCredits}</div>
                        </div>
                    </div>
                </div>

                <!-- Semester Accordion Cards Header -->
                <div class="flex items-center justify-between px-1">
                    <h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
                        <span>Completed Semesters</span>
                        <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-extrabold">${semesters.length}</span>
                    </h3>
                </div>
        `;

        if (semesters.length === 0) {
            html += `
                <div class="bg-white rounded-2xl p-8 text-center border border-slate-200 shadow-sm">
                    <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                        </svg>
                    </div>
                    <p class="text-sm font-semibold text-slate-700">No Semester History Found</p>
                    <p class="text-xs text-slate-400 mt-1">Scrape SITAM ERP or refresh results to populate completed semesters.</p>
                </div>
            `;
        } else {
            semesters.forEach((sem, idx) => {
                const semId = `v2-sem-${sem.semester || idx}`;
                const isFirst = idx === 0;

                html += `
                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200 hover:border-slate-300">
                        <button onclick="AcademicV2.toggleSemester('${semId}')" class="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors">
                            <div class="flex items-center space-x-3">
                                <div class="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-extrabold text-sm border border-indigo-100">
                                    S${sem.semester}
                                </div>
                                <div>
                                    <h4 class="font-bold text-slate-800 text-sm">${sem.semesterName || 'Semester ' + sem.semester}</h4>
                                    <p class="text-xs text-slate-500 font-medium mt-0.5">
                                        SGPA: <span class="font-bold text-indigo-600">${sem.sgpa || '--'}</span> | Credits: <span class="font-semibold text-slate-700">${sem.creditsEarned || sem.credits || '--'}</span>
                                    </p>
                                </div>
                            </div>
                            <div class="flex items-center space-x-2">
                                <span class="text-xs font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-600">
                                    ${(sem.subjects || []).length} Subjects
                                </span>
                                <svg id="${semId}-chevron" class="w-5 h-5 text-slate-400 transform transition-transform duration-200 ${isFirst ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                                </svg>
                            </div>
                        </button>

                        <div id="${semId}-content" class="${isFirst ? '' : 'hidden'} border-t border-slate-100 p-4 bg-slate-50/50">
                            <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-inner">
                                <table class="w-full text-left text-xs">
                                    <thead class="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                                        <tr>
                                            <th class="p-3">Subject</th>
                                            <th class="p-3 text-center">Type</th>
                                            <th class="p-3 text-center">Grade</th>
                                            <th class="p-3 text-center">Credits</th>
                                            <th class="p-3 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-slate-100">
                `;

                (sem.subjects || []).forEach(sub => {
                    const isPass = sub.result !== 'FAIL' && sub.grade !== 'F' && sub.grade !== 'ABSENT';
                    html += `
                        <tr class="hover:bg-slate-50">
                            <td class="p-3">
                                <div class="font-bold text-slate-800">${sub.name || sub.code}</div>
                                <div class="text-[10px] text-slate-400 font-mono">${sub.code}</div>
                            </td>
                            <td class="p-3 text-center">
                                <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${sub.type === 'Lab' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}">
                                    ${sub.type || 'Core'}
                                </span>
                            </td>
                            <td class="p-3 text-center font-black text-slate-800">${sub.grade || '--'}</td>
                            <td class="p-3 text-center font-semibold text-slate-600">${sub.credits || '3.0'}</td>
                            <td class="p-3 text-center">
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
                                    ${isPass ? 'PASS' : 'FAIL'}
                                </span>
                            </td>
                        </tr>
                    `;
                });

                html += `
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        html += `</div>`;
        target.innerHTML = html;
    }

    /**
     * Accordion toggle helper for semester cards
     * @param {string} semId 
     */
    function toggleSemester(semId) {
        const content = document.getElementById(`${semId}-content`);
        const chevron = document.getElementById(`${semId}-chevron`);
        if (content) {
            content.classList.toggle('hidden');
        }
        if (chevron) {
            chevron.classList.toggle('rotate-180');
        }
    }

    return {
        renderDashboardCard,
        renderResultsScreen,
        toggleSemester
    };
})();
