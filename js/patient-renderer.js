
// -------------------------------------------------------------------------
// Patient Card Renderer (Extracted for better maintainability)
// -------------------------------------------------------------------------

/**
 * Renders the grid of patient cards
 * Overrides the function in main.js
 * @param {Array} patients 
 */
function renderPatientsGrid(patients) {
    const grid = document.getElementById('patients-grid');
    grid.innerHTML = '';

    if (!patients || patients.length === 0) {
        grid.innerHTML = '<div class="col-span-3 text-center text-slate-400 py-10">No patients in this ward</div>';
        return;
    }

    patients.forEach((p, index) => {
        const card = document.createElement('div');

        // Base classes
        let classes = "bg-white rounded-2xl p-4 md:p-5 shadow-sm transition-all duration-300 border border-slate-100 relative overflow-hidden animate-entry opacity-0";

        // Interactive classes
        if (!appData.selectionMode) {
            classes += " hover:shadow-lg hover:-translate-y-1 cursor-pointer group";
        } else {
            classes += " cursor-pointer";
        }

        // Highlight Logic
        if (p.is_highlighted) {
            classes += " ring-2 ring-yellow-400 bg-yellow-50/30";
        }

        // Selection State Logic
        const isSelected = appData.selectedPatientIds && appData.selectedPatientIds.has(p.id);
        if (isSelected) {
            classes += " ring-2 ring-medical-500 bg-medical-50";
        }

        card.className = classes;
        card.style.animationDelay = `${index * 50}ms`;

        // Click Handler
        card.onclick = (e) => {
            if (appData.selectionMode) {
                e.stopPropagation();
                if (typeof togglePatientSelection === 'function') togglePatientSelection(p.id, card);
            } else {
                if (typeof openModal === 'function') openModal(p);
            }
        };

        // --- Selection Checkbox ---
        let selectionCheckbox = '';
        if (appData.selectionMode) {
            const checkStateClass = isSelected ? 'bg-medical-500 border-medical-500' : 'bg-white border-slate-300';
            const checkIconClass = isSelected ? '' : 'hidden';
            selectionCheckbox = `
                <div class="absolute top-4 right-4 z-20">
                    <div class="checkbox-indicator w-6 h-6 rounded-full border-2 ${checkStateClass} flex items-center justify-center transition-all">
                        <i class="fa-solid fa-check text-white text-xs ${checkIconClass}"></i>
                    </div>
                </div>
            `;
        }

        // --- Labs Badges ---
        let labBadges = '';
        if (p.labs) {
            Object.entries(p.labs).forEach(([k, v]) => {
                const isStandard = appData.ranges && appData.ranges[k];
                // Use global checkLabStatus if available
                const status = (isStandard && typeof checkLabStatus === 'function') ? checkLabStatus(k, v.value) : 'custom';

                if (status !== 'normal' && v.value) {
                    let colorClass = 'bg-indigo-50 text-indigo-600 border-indigo-100';
                    let icon = '•';

                    if (status === 'high') {
                        colorClass = 'bg-red-50 text-red-600 border-red-100';
                        icon = '↑';
                    } else if (status === 'low') {
                        colorClass = 'bg-orange-50 text-orange-600 border-orange-100';
                        icon = '↓';
                    }

                    labBadges += `
                        <div class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${colorClass} flex items-center gap-1">
                            <span>${k}</span>
                            <span>${v.value}</span>
                            <span>${icon}</span>
                        </div>
                    `;
                }
            });
        }

        // --- Symptoms (Active + Notes) ---
        let symptomText = '';
        if (p.symptoms) {
            // Filter where value.active is true
            const activeSymptoms = Object.entries(p.symptoms)
                .filter(([k, v]) => v && v.active === true);

            if (activeSymptoms.length > 0) {
                const chips = activeSymptoms.map(([k, v]) => {
                    let noteHtml = '';
                    if (v.note && v.note.trim()) {
                        noteHtml = `<span class="ml-1 pl-1 border-l border-rose-200 text-rose-800 italic font-normal max-w-[150px] truncate inline-block align-bottom">${v.note}</span>`;
                    }

                    return `<span class="px-1.5 py-0.5 rounded border text-[10px] bg-rose-50 text-rose-700 border-rose-100 font-bold flex items-center mb-1 mr-1 w-max max-w-full">
                        <span class="shrink-0">${k}</span>
                        ${noteHtml}
                    </span>`;
                }).join('');
                symptomText = `<div class="flex flex-wrap mt-2">${chips}</div>`;
            }
        }

        // --- Plan Text Preview (UPDATED: Text List) ---
        let planPreviewHTML = '';
        if (p.plan && Array.isArray(p.plan) && p.plan.length > 0) {
            planPreviewHTML = `<div class="mt-3 pt-2 border-t border-slate-50 grid grid-cols-3 gap-1">`;
            p.plan.forEach((item, i) => {
                let colorClass = 'text-slate-600';
                let icon = 'circle';

                if (item.type === 'medication') { colorClass = 'text-indigo-600'; icon = 'pills'; }
                else if (item.type === 'equipment') { colorClass = 'text-cyan-600'; icon = 'mask-ventilator'; }
                else if (item.type === 'consult') { colorClass = 'text-purple-600'; icon = 'user-doctor'; }
                else if (item.type === 'note') { colorClass = 'text-amber-600'; icon = 'note-sticky'; }

                let displayText = item.details;
                if (item.type === 'medication' && item.action) displayText = `<strong>${item.action}:</strong> ${item.details}`;

                planPreviewHTML += `
                    <div class="group/plan flex gap-2 items-start text-xs ${colorClass} relative pr-4">
                        <i class="fa-solid fa-${icon} mt-0.5 shrink-0"></i>
                        <span class="break-words font-medium leading-tight">${displayText}</span>
                        
                        <button class="absolute -right-1 -top-1 text-slate-300 hover:text-red-500 opacity-0 group-hover/plan:opacity-100 transition-opacity p-1" 
                                onclick="deletePlanItem(event, '${p.id}', ${i})"
                                title="Remove item">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                `;
            });
            planPreviewHTML += `</div>`;
        }

        // Highlight Star
        const starClass = p.is_highlighted ? 'text-yellow-400 opacity-100' : 'text-slate-200 opacity-0 group-hover:opacity-100';

        // --- Render Card HTML (Refined Version) ---
        card.innerHTML = `
            ${selectionCheckbox}
            <button class="absolute top-4 right-4 z-10 ${starClass} hover:text-yellow-400 transition-all ${appData.selectionMode ? 'hidden' : ''}" onclick="toggleHighlight(event, '${p.id}')">
                <i class="fa-solid fa-star"></i>
            </button>

            <!-- Header: Full Name & Age Badge -->
            <div class="flex justify-between items-start mb-3 pr-8">
                <div>
                     <h3 class="font-bold text-lg text-slate-800 group-hover:text-medical-600 transition-colors leading-tight">
                        ${p.name} 
                        <span class="inline-block bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded ml-1 align-middle">${parseInt(p.age || 0)}</span>
                     </h3>
                     <div class="text-xs text-slate-400 font-mono mt-0.5">${p.code}</div>
                </div>
                <div class="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded-lg whitespace-nowrap">RM ${p.room}</div>
            </div>
            
            ${labBadges ? `<div class="flex flex-wrap gap-1 mb-3">${labBadges}</div>` : ''}

            <!-- Dx & Rx -->
            <div class="space-y-2 mb-3">
                ${p.diagnosis ? `
                <div class="text-sm text-slate-700">
                    <span class="font-bold text-blue-600 text-xs uppercase mr-1 bg-blue-50 px-1 rounded">Dx</span> 
                    ${p.diagnosis}
                </div>` : ''}
                
                ${p.treatment ? `
                <div class="text-sm text-slate-600 whitespace-pre-wrap leading-snug">
                    <span class="font-bold text-emerald-600 text-xs uppercase mr-1 bg-emerald-50 px-1 rounded">Rx</span> 
                    ${p.treatment}
                </div>` : ''}
            </div>

            ${symptomText ? symptomText : ''}
            
            ${planPreviewHTML}

            <!-- Footer Buttons -->
            <div class="flex items-center gap-2 mt-3 pt-3 border-t border-slate-50 justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-xs text-slate-500 font-medium" title="${p.provider || 'Unassigned'}">
                        <i class="fa-solid fa-user-doctor mr-1"></i> ${p.provider || 'Unassigned'}
                    </span>
                </div>
                
                ${!appData.selectionMode ? `
                <div class="flex gap-2">
                    ${p.labImages && p.labImages.length > 0 ? `
                    <button class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white flex items-center justify-center transition-colors btn-view-labs" title="View Labs">
                        <i class="fa-solid fa-flask"></i>
                    </button>` : ''}
                    <button class="w-8 h-8 rounded-full bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white flex items-center justify-center transition-colors btn-symptoms" title="Symptoms Assessment">
                        <i class="fa-solid fa-notes-medical"></i>
                    </button>
                    <button class="w-8 h-8 rounded-full bg-violet-50 text-violet-600 hover:bg-violet-600 hover:text-white flex items-center justify-center transition-colors btn-plan" title="Plan">
                        <i class="fa-solid fa-list-check"></i>
                    </button>
                    <button class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white flex items-center justify-center transition-colors btn-meds" title="View Medications">
                        <!-- Theme icon handled dynamically or assumed fallback -->
                        <i class="fa-solid fa-pills cursor-pointer"></i>
                    </button>
                </div>` : ''}
            </div>
        `;

        if (!appData.selectionMode) {
            // Attach event listener for Meds
            const medBtn = card.querySelector('.btn-meds');
            if (medBtn) {
                medBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof openMedicationModal === 'function') openMedicationModal(p);
                };
            }
            // Attach event listener for Plan
            const planBtn = card.querySelector('.btn-plan');
            if (planBtn) {
                planBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof openPlanModal === 'function') openPlanModal(p);
                };
            }
            // Attach event listener for Symptoms
            const symBtn = card.querySelector('.btn-symptoms');
            if (symBtn) {
                symBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof openSymptomsModal === 'function') openSymptomsModal(p);
                };
            }
            // Attach event listener for View Labs
            const labsBtn = card.querySelector('.btn-view-labs');
            if (labsBtn) {
                labsBtn.onclick = (e) => {
                    e.stopPropagation();
                    // Open the LAST image (most recent)
                    if (p.labImages && p.labImages.length > 0) {
                        const lastImg = p.labImages[p.labImages.length - 1];
                        // Use the local URL (Base64) if valid, otherwise fallback to Drive ID logic
                        const robustUrl = (lastImg.url && lastImg.url.length > 50)
                            ? lastImg.url
                            : `https://drive.google.com/thumbnail?id=${lastImg.id}&sz=w3000`;

                        if (typeof openImageLightbox === 'function') {
                            openImageLightbox(robustUrl);
                        } else {
                            // Fallback if main.js not loaded (unlikely)
                            window.open(lastImg.url, '_blank');
                        }
                    }
                };
            }
        }

        grid.appendChild(card);
    });
}
