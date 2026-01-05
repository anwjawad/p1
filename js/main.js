
// --------------------------------------------------------
// CONFIGURATION
// --------------------------------------------------------
// Use var to prevent "already declared" errors if script is double-loaded
var GAS_API_URL = "https://script.google.com/macros/s/AKfycbxJ0bG4MEptJCL_4057PM1UkFXrVSp5Vyydrq4ZvAUzGt3-gqyGq4aV1UhRpi90tszK/exec";

var appData = {
    patients: [],
    wards: {},
    sections: [], // Persistent Sections Metadata
    selectionMode: false,
    selectedPatientIds: new Set(),

    // Hardcoded ranges since they are static
    ranges: {
        'Cl': [98, 107],          // Chloride
        'K': [3.5, 5.1],          // Potassium
        'Na': [136, 145],         // Sodium
        'Tb': [0.1, 1.2],         // Total Bilirubin
        'Db': [0, 0.3],           // Direct Bilirubin (Est)
        'Alb': [3.4, 5.4],        // Albumin
        'Mg': [1.7, 2.2],         // Magnesium
        'Ph': [2.5, 4.5],         // Phosphorous (Est)
        'Ca': [8.6, 10.3],        // Calcium
        'CRP': [0, 10],           // C-reactive protein
        'SGOT': [8, 45],          // Aspartate Amino Transferase
        'SGPT': [7, 56],          // Alanine Amino Transferase
        'ALP': [44, 147],         // Alkaline Phosphatase (Est)
        'LDH': [140, 280],        // Lactate Dehydrogenase (Est)
        'SCr': [0.7, 1.3],        // Serum Creatinine
        'BUN': [7, 20],           // Blood Urea Nitrogen
        'WBC': [4.0, 11.0],       // WBC
        'RBC': [4.5, 5.5],        // RBC (Est)
        'HGB': [13.5, 17.5],      // HGB
        'PLT': [150, 450]         // PLT
        // 'Other' handled dynamically
    },
    currentWard: null,

    currentPatient: null
};

// Search Logic
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        let allPatients = [];

        // Flatten patients from all wards
        Object.values(appData.wards).forEach(list => {
            allPatients = allPatients.concat(list);
        });

        if (query === '') {
            // Restore current ward view
            if (appData.currentWard) {
                selectWard(appData.currentWard);
            }
            return;
        }

        // Filter
        const filtered = allPatients.filter(p =>
            (p.name && p.name.toLowerCase().includes(query)) ||
            (p.code && p.code.toLowerCase().includes(query)) ||
            (p.diagnosis && p.diagnosis.toLowerCase().includes(query))
        );

        // Render search results
        document.getElementById('current-ward-title').innerText = `Search Results (${filtered.length})`;
        renderPatientsGrid(filtered);
    });
}

function openNewPatientModal() {
    const newPatient = {
        id: Date.now().toString(),
        name: "New Patient",
        code: "TEMP-" + Math.floor(Math.random() * 1000),
        age: 0,
        room: "TBD",
        ward: appData.currentWard || "Unassigned",
        diagnosis: "",
        treatment: "",
        notes: "",
        medications: "",
        labs: {},
        symptoms: {}
    };

    // Add to local data immediately (optimistic)
    if (!appData.wards[newPatient.ward]) appData.wards[newPatient.ward] = [];
    appData.wards[newPatient.ward].push(newPatient);

    // Render and select
    renderWardsSidebar();
    selectWard(newPatient.ward);

    // Open Modal
    openModal(newPatient);
}

// Toggle Mobile Sidebar
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    // Toggle Sidebar visibility
    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');

        // Show Overlay
        overlay.classList.remove('hidden');
        // Small delay to allow display:block to apply before opacity transition
        setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    } else {
        // Close
        sidebar.classList.add('-translate-x-full');

        // Hide Overlay
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
}

// Auto-save timer
var saveTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    if (GAS_API_URL.includes("Paste_Your")) {
        alert("Please paste your Google Web App URL in main.js file!");
        loadMockData();
    } else {
        fetchData();
    }
    setupSearch();
});

function loadMockData() {
    // Just so the UI isn't empty on first open
    appData.wards = { 'Demo Ward': [] };
    renderWardsSidebar();
}

async function fetchData() {
    try {
        document.getElementById('patient-count').innerText = "...";
        const res = await fetch(GAS_API_URL);
        const json = await res.json();

        let patients = [];
        let metadata = {};

        // Handle V1 and V2 responses (V2 has {patients, metadata})
        if (Array.isArray(json)) {
            patients = json;
        } else if (json.patients) {
            patients = json.patients;
            metadata = json.metadata || {};
        } else if (json.error) {
            alert("Error from Sheet: " + json.error);
            return;
        }

        // Parse complex fields (Plans)
        patients.forEach(p => {
            if (p.plan && typeof p.plan === 'string') {
                try { p.plan = JSON.parse(p.plan); } catch (e) { p.plan = []; }
            }
            if (!Array.isArray(p.plan)) p.plan = [];
        });

        appData.patients = patients;

        // Load Sections from Metadata
        if (metadata.sections) {
            try {
                appData.sections = typeof metadata.sections === 'string' ? JSON.parse(metadata.sections) : metadata.sections;
            } catch (e) {
                console.warn("Failed to parse sections metadata", e);
                appData.sections = [];
            }
        } else {
            // Recover sections from existing patient wards if no metadata
            const rawWards = [...new Set(patients.map(p => p.ward))].filter(w => w);
            appData.sections = rawWards.map(w => ({
                id: w,
                name: w,
                color: 'slate',
                icon: 'hospital',
                isPersistent: false // Auto-discovered
            }));
        }

        // Group by Ward (Compute derived state)
        rebuildWardsMap();

        renderWardsSidebar();

        // Select first ward by default, or keep current if valid
        const wardKeys = Object.keys(appData.wards);
        if (appData.currentWard && wardKeys.includes(appData.currentWard)) {
            selectWard(appData.currentWard);
        } else {
            const firstWard = wardKeys[0];
            if (firstWard) selectWard(firstWard);
        }

    } catch (e) {
        console.error("Failed to load data", e);
        document.getElementById('patient-count').innerText = "Err";
    }
}

function rebuildWardsMap() {
    appData.wards = {};

    // 1. Initialize empty arrays for all Persistent Sections
    appData.sections.forEach(s => {
        appData.wards[s.name] = [];
    });

    // 2. Distribute Patients
    if (Array.isArray(appData.patients)) {
        appData.patients.forEach(p => {
            // Basic Normalization
            if (!p.ward) p.ward = "Unassigned";

            // If ward doesn't exist in sections (e.g. new from sheet), create ad-hoc section? 
            // Or just add to wards map logic.
            // We choose: Add to wards map.
            if (!appData.wards[p.ward]) {
                appData.wards[p.ward] = [];
                // Should we auto-add to sections? Yes, for display consistency
                if (!appData.sections.find(s => s.name === p.ward)) {
                    appData.sections.push({ name: p.ward, color: 'slate', icon: 'hospital', isPersistent: false });
                }
            }
            appData.wards[p.ward].push(p);
        });
    }
}

function saveMetadata() {
    // Save sections state to backend
    // We can piggyback on a patient update or simpler: send special action
    if (GasApiAvailable()) {
        const payload = {
            action: 'save_metadata',
            metadata: {
                sections: JSON.stringify(appData.sections)
            }
        };
        fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Avoid Options
            body: JSON.stringify(payload)
        }).catch(e => console.error("Metadata save failed", e));
    }
}

function renderWardsSidebar() {
    const list = document.getElementById('wards-list');
    list.innerHTML = '';

    appData.sections.forEach(section => {
        const wardName = section.name;
        const patients = appData.wards[wardName] || [];
        const count = patients.length;

        // Skip empty NON-persistent wards (clean up)
        if (!section.isPersistent && count === 0) return;

        const btn = document.createElement('div');
        const isActive = appData.currentWard === wardName;

        // Styling based on color
        const colorMap = {
            'slate': 'bg-slate-200 text-slate-700 group-hover:bg-slate-300',
            'blue': 'bg-blue-100 text-blue-600 group-hover:bg-blue-200',
            'red': 'bg-red-100 text-red-600 group-hover:bg-red-200',
            'green': 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200',
            'purple': 'bg-violet-100 text-violet-600 group-hover:bg-violet-200',
            'orange': 'bg-orange-100 text-orange-600 group-hover:bg-orange-200'
        };
        const iconColorClass = colorMap[section.color] || colorMap['slate'];
        const activeClass = isActive ? 'bg-white shadow-md ring-1 ring-slate-200' : 'hover:bg-slate-50';

        btn.className = `p-3 rounded-lg cursor-pointer transition-all flex justify-between items-center group ward-item relative overflow-hidden mb-2 ${activeClass}`;
        btn.onclick = (e) => {
            if (e.target.closest('.delete-ward-btn')) return;
            selectWard(wardName);
        }

        btn.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg ${iconColorClass} flex items-center justify-center transition-colors">
                     <i class="fa-solid fa-${section.icon || 'hospital'}"></i>
                </div>
                <div class="flex flex-col">
                    <span class="font-bold text-sm text-slate-700">${wardName}</span>
                    <span class="text-[10px] text-slate-400 font-medium">${count} Patients</span>
                </div>
            </div>
            
            <button class="delete-ward-btn w-6 h-6 rounded-full hover:bg-red-100 text-slate-300 hover:text-red-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100" title="Delete Section">
                <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
        `;

        // Delete Handler
        const delBtn = btn.querySelector('.delete-ward-btn');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteWard(wardName);
        };

        list.appendChild(btn);
    });
}

function deleteWard(wardName) {
    if (!confirm(`Delete section "${wardName}"? Patients will be moved to Unassigned.`)) return;

    // 1. Move patients to Unassigned
    const patients = appData.wards[wardName] || [];
    const updates = {};

    patients.forEach(p => {
        p.ward = "Unassigned";
        updates[p.id] = { ward: "Unassigned" };
    });

    // 2. Remove Section
    appData.sections = appData.sections.filter(s => s.name !== wardName);
    delete appData.wards[wardName];

    // 3. Sync
    saveMetadata();
    if (Object.keys(updates).length > 0) syncBatchUpdate(updates);

    // 4. Refresh
    rebuildWardsMap(); // Re-process unassigned
    renderWardsSidebar();
    if (appData.currentWard === wardName) selectWard('Unassigned');
}

async function syncBatchUpdate(updates) {
    if (Object.keys(updates).length === 0) return;

    document.getElementById('save-status').innerText = "Processing batch update...";

    try {
        const payload = {
            action: 'batch_update',
            updates: updates
        };

        await fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        document.getElementById('save-status').innerHTML = '<i class="fa-solid fa-check text-green-500 mr-1"></i> Changes saved';

    } catch (e) {
        console.error("Batch update failed", e);
        document.getElementById('save-status').innerText = "Update Failed!";
    }
}

function GasApiAvailable() {
    return !GAS_API_URL.includes("Paste_Your");
}

// --- Bulk Actions & UI ---

function toggleSelectionMode() {
    appData.selectionMode = !appData.selectionMode;
    appData.selectedPatientIds.clear();

    const btn = document.getElementById('btn-select-mode');
    const floatBar = document.getElementById('floating-action-bar');

    if (appData.selectionMode) {
        btn.classList.add('bg-slate-800', 'text-white');
        btn.classList.remove('bg-white', 'text-slate-600');
        btn.innerHTML = '<i class="fa-solid fa-times mr-2"></i> Cancel Selection';
    } else {
        btn.classList.remove('bg-slate-800', 'text-white');
        btn.classList.add('bg-white', 'text-slate-600');
        btn.innerHTML = '<i class="fa-solid fa-check-double mr-2"></i> Select';
        floatBar.classList.add('translate-y-24'); // Hide
    }

    // Re-render current view to show/hide checkboxes
    if (appData.currentWard) {
        renderPatientsGrid(appData.wards[appData.currentWard]);
    }
}

function updateFloatingActionBar() {
    const floatBar = document.getElementById('floating-action-bar');
    const countSpan = document.getElementById('selected-count');
    const count = appData.selectedPatientIds.size;

    countSpan.innerText = count;

    if (count > 0) {
        floatBar.classList.remove('translate-y-24'); // Show
    } else {
        floatBar.classList.add('translate-y-24'); // Hide
    }
}

function togglePatientSelection(id, cardElement) {
    if (appData.selectedPatientIds.has(id)) {
        appData.selectedPatientIds.delete(id);
        cardElement.classList.remove('ring-2', 'ring-medical-500', 'bg-medical-50');
        cardElement.querySelector('.checkbox-indicator').classList.remove('bg-medical-500', 'border-medical-500');
        cardElement.querySelector('.checkbox-indicator').classList.add('bg-white', 'border-slate-300');
        cardElement.querySelector('.checkbox-indicator i').classList.add('hidden');
    } else {
        appData.selectedPatientIds.add(id);
        cardElement.classList.add('ring-2', 'ring-medical-500', 'bg-medical-50');
        cardElement.querySelector('.checkbox-indicator').classList.add('bg-medical-500', 'border-medical-500');
        cardElement.querySelector('.checkbox-indicator').classList.remove('bg-white', 'border-slate-300');
        cardElement.querySelector('.checkbox-indicator i').classList.remove('hidden');
    }
    updateFloatingActionBar();
}

function executeBulkMove() {
    const targetWard = prompt("Enter target Ward/Section name exactly:");
    if (!targetWard) return;

    // Validate Ward
    if (!appData.wards[targetWard] && !appData.sections.find(s => s.name === targetWard)) {
        alert("Ward not found. Please create it first.");
        return;
    }

    const updates = {};
    const ids = Array.from(appData.selectedPatientIds);

    ids.forEach(id => {
        // Find patient object
        const p = appData.patients.find(pt => pt.id === id);
        if (p) {
            // Remove from old ward array locally
            if (appData.wards[p.ward]) {
                appData.wards[p.ward] = appData.wards[p.ward].filter(x => x.id !== id);
            }

            // Update
            p.ward = targetWard;

            // Add to new ward array locally
            if (!appData.wards[targetWard]) appData.wards[targetWard] = [];
            appData.wards[targetWard].push(p);

            updates[id] = { ward: targetWard };
        }
    });

    // Sync
    syncBatchUpdate(updates);

    // Reset UI
    toggleSelectionMode(); // Exit mode
    selectWard(targetWard); // Jump to destination
}

function executeBulkDelete() {
    const ids = Array.from(appData.selectedPatientIds);
    if (!confirm(`Permanently delete ${ids.length} patients?`)) return;

    // We actually just "Archive" or Delete?
    // Let's implement Delete logic by moving to "Trash" or actually un-listing them?
    // User requested "Delete". Let's assume remove row.
    // BUT our backend batch_update only UPDATES fields.
    // We need a way to DELETE.
    // For now, let's mark them as ward="TRASH" or similar? 
    // Or we add a `deleted: true` flag if we want soft delete.
    // Real deletion requires Row Deletion support in backend.

    // Let's use Soft Delete: Ward = "TRASH"
    const updates = {};
    ids.forEach(id => {
        const p = appData.patients.find(pt => pt.id === id);
        if (p) {
            // Remove locally
            if (appData.wards[p.ward]) {
                appData.wards[p.ward] = appData.wards[p.ward].filter(x => x.id !== id);
            }
            p.ward = "TRASH";
            updates[id] = { ward: "TRASH" };
        }
    });

    syncBatchUpdate(updates);
    toggleSelectionMode();
    // Refresh current view
    if (appData.currentWard) selectWard(appData.currentWard);
}

// ---------------------------

function selectWard(wardName) {
    appData.currentWard = wardName;
    document.getElementById('current-ward-title').innerText = wardName;

    // Refresh Sidebar to update highlights
    renderWardsSidebar();

    // Render Patients
    const patients = appData.wards[wardName] || [];
    renderPatientsGrid(patients);
}



function toggleHighlight(e, id) {
    e.stopPropagation();
    const p = appData.patients.find(pt => pt.id === id);
    if (!p) return;

    // Toggle
    p.is_highlighted = !p.is_highlighted;

    // Optimistic Update
    renderPatientsGrid(appData.wards[appData.currentWard]);

    // Sync
    const updates = {};
    updates[id] = { is_highlighted: p.is_highlighted };
    if (GasApiAvailable()) syncBatchUpdate(updates);
}

function checkLabStatus(name, value) {
    if (!appData.ranges[name]) return 'normal';
    const [min, max] = appData.ranges[name];
    if (value < min) return 'low';
    if (value > max) return 'high';
    return 'normal';
}

function openModal(patient) {
    appData.currentPatient = patient;
    const modal = document.getElementById('patient-modal');
    const panel = document.getElementById('modal-panel');

    document.getElementById('modal-patient-name').value = patient.name;
    document.getElementById('modal-patient-code').value = patient.code;
    document.getElementById('modal-patient-age').value = parseInt(patient.age) || 0;
    document.getElementById('modal-patient-room').value = patient.room;

    document.getElementById('inp-diagnosis').value = patient.diagnosis || '';
    document.getElementById('inp-provider').value = patient.provider || '';
    document.getElementById('inp-treatment').value = patient.treatment || '';

    // 2. Parse Complex Fields (Symptoms, Labs, Meds)
    try {
        if (patient.symptoms && typeof patient.symptoms === 'string') {
            patient.symptoms = JSON.parse(patient.symptoms);
        }
    } catch (e) { patient.symptoms = {}; }
    if (!patient.symptoms || typeof patient.symptoms !== 'object') patient.symptoms = {};

    try {
        if (patient.labs && typeof patient.labs === 'string') {
            patient.labs = JSON.parse(patient.labs);
        }
    } catch (e) { patient.labs = {}; }

    // Ensure Labs is an object (not array)
    if (!patient.labs || typeof patient.labs !== 'object' || Array.isArray(patient.labs)) patient.labs = {};

    try {
        if (patient.history_symptoms && typeof patient.history_symptoms === 'string') {
            patient.history_symptoms = JSON.parse(patient.history_symptoms);
        }
    } catch (e) { /* ignore */ }

    try {
        if (patient.history_labs && typeof patient.history_labs === 'string') {
            patient.history_labs = JSON.parse(patient.history_labs);
        }
    } catch (e) { /* ignore */ }

    // Meds parsing for modal
    let meds = { regular: '', prn: '' };
    // robust assignment
    if (patient.medications && typeof patient.medications === 'object') {
        meds = patient.medications;
    } else {
        try {
            if (patient.medications && typeof patient.medications === 'string' && patient.medications.trim().startsWith('{')) {
                meds = JSON.parse(patient.medications);
            } else {
                meds.regular = patient.medications || '';
            }
        } catch (e) {
            meds.regular = patient.medications || '';
        }
    }

    // Safety checks
    if (!meds.regular) meds.regular = '';
    if (!meds.prn) meds.prn = '';

    // Render Meds Inputs
    document.getElementById('inp-medications-regular').value = meds.regular || '';
    document.getElementById('inp-medications-prn').value = meds.prn || '';

    document.getElementById('inp-notes').value = patient.notes || '';
    document.getElementById('inp-notes').value = patient.notes || '';

    // Attach Listeners to ALL inputs including header fields
    ['modal-patient-name', 'modal-patient-code', 'modal-patient-age', 'modal-patient-room',
        'inp-diagnosis', 'inp-provider', 'inp-treatment', 'inp-medications-regular', 'inp-medications-prn', 'inp-notes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = () => triggerSave();
        });

    // Smart Paste for Regular Meds
    document.getElementById('inp-medications-regular').addEventListener('paste', handleRegularPaste);
    // Smart Paste for PRN Meds
    document.getElementById('inp-medications-prn').addEventListener('paste', handlePrnPaste);

    renderModalLabs(patient.labs || {});
    renderModalSymptoms(patient.symptoms || {});

    modal.classList.remove('hidden');
    setTimeout(() => { panel.classList.remove('translate-x-full'); }, 10);
}

function handleRegularPaste(e) {
    e.preventDefault();
    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
    const lines = pastedText.split(/\r?\n/);
    const processedMeds = new Map();

    // Regular Regex Patterns
    const freqRegex = /\b(OD|BID|TID|QID|Q\d+H|DAILY|HS|PRN|STAT|NOW)\b/i;
    const routeRegex = /\b(PO|IV|SC|IM|SL|PR|NG|TOP|Sub-Q|NEB)\b/i;

    lines.forEach(line => {
        if (!line.trim()) return;
        const cols = line.split('\t');
        if (cols.length < 3) return;

        // 1. Identify Status to filter out
        // In sample: Status in last col (Pending...) OR Col 3 'dc'
        // Let's Search for specific negative keywords in the whole row to be safe?
        // Or assume last column is status.
        const fullRowStr = line.toLowerCase();
        if (fullRowStr.includes('discontinued') || fullRowStr.includes('canceled') || fullRowStr.includes('held')) return;

        // Col 3 check for 'dc'
        if (cols[3] && cols[3].trim().toLowerCase() === 'dc') return;

        // 2. Identify Columns
        // Sample: Col 0 = Name, Col 1 = Detail (Dose Freq Route)
        // Check if Col 1 looks like detail (contains dose/freq)
        let nameIndex = 0;
        let detailIndex = 1;

        // Validation: Does Col 1 have Freq or Route?
        if (!freqRegex.test(cols[1]) && !routeRegex.test(cols[1])) {
            // Maybe shifted? Try to find the Detail column
            for (let i = 0; i < cols.length; i++) {
                if (freqRegex.test(cols[i]) || routeRegex.test(cols[i])) {
                    detailIndex = i;
                    nameIndex = i - 1; // Assume Name is before Detail
                    break;
                }
            }
        }

        if (nameIndex < 0 || !cols[nameIndex]) return;

        const name = cols[nameIndex].trim();
        const details = cols[detailIndex] ? cols[detailIndex].trim() : '';

        // 3. Format
        // User wants: Name (Unique), Dose, Frequency.
        // Details usually contains "40mg OD Sub-Q".
        // Let's Clean Details: Keep strictly what we want? 
        // Or just use the whole string as it usually has Dose + Freq + Route.
        // "40mg OD PO" is perfect.

        // Deduplicate
        if (!processedMeds.has(name)) {
            processedMeds.set(name, `${name} ${details}`);
        }
    });

    if (processedMeds.size === 0) {
        // Safe Paste Fallback
        const textarea = e.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentVal = textarea.value;
        const insert = pastedText;
        if (currentVal.trim() === '') textarea.value = insert;
        else textarea.value = currentVal.substring(0, start) + insert + currentVal.substring(end);
        triggerSave();
        return;
    }

    const finalOutput = Array.from(processedMeds.values()).join('\n');

    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;

    if (currentVal.trim() === '') {
        textarea.value = finalOutput;
    } else {
        textarea.value = currentVal.substring(0, start) + finalOutput + currentVal.substring(end);
    }

    triggerSave();
}

function handlePrnPaste(e) {
    const pastedText = (e.clipboardData || window.clipboardData).getData('text');

    // Process the text
    const lines = pastedText.split(/\r?\n/);
    const processedMeds = new Map();
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // 1. Try to Parse
    lines.forEach(line => {
        if (!line.trim()) return;
        const cols = line.split('\t');
        if (cols.length < 5) return;

        // Dynamic Parsing: Anchor on "Route"
        let routeIndex = -1;
        const routeRegex = /^(PO|IV|SC|IM|SL|PR|NG|TOP|SUBCUT|ORAL|RECTAL)$/i;

        for (let i = 0; i < cols.length; i++) {
            if (routeRegex.test(cols[i].trim())) {
                routeIndex = i;
                break;
            }
        }

        // Fallback: look for Unit
        if (routeIndex === -1) {
            const unitRegex = /^(mg|mcg|g|ml|tab|cap)$/i;
            for (let i = 0; i < cols.length; i++) {
                if (unitRegex.test(cols[i].trim())) {
                    routeIndex = i - 2;
                    break;
                }
            }
        }

        if (routeIndex === -1 || routeIndex < 1) return;

        const name = cols[routeIndex - 1].trim();
        const route = cols[routeIndex].trim();
        const dose = cols[routeIndex + 1] ? cols[routeIndex + 1].trim() : '';
        const unit = cols[routeIndex + 2] ? cols[routeIndex + 2].trim() : '';
        const indication = cols[routeIndex + 3] ? cols[routeIndex + 3].trim() : '';

        let status = '';
        let adminTimeStr = '';

        // Search for Status from end
        for (let j = cols.length - 1; j > routeIndex + 3; j--) {
            const val = cols[j].trim().toLowerCase();
            if (['taken', 'canceled', 'discontinued', 'pending', 'not taken'].includes(val)) {
                status = val;
                // Heuristic: Admin Time is usually near Status (j-1, j-2, or j-3)
                // Look for YYYY-MM-DD pattern
                const dateRegex = /\d{4}-\d{2}-\d{2}/;
                if (cols[j - 1] && dateRegex.test(cols[j - 1])) adminTimeStr = cols[j - 1];
                else if (cols[j - 2] && dateRegex.test(cols[j - 2])) adminTimeStr = cols[j - 2];
                else if (cols[j - 3] && dateRegex.test(cols[j - 3])) adminTimeStr = cols[j - 3];
                break;
            }
        }

        if (status === 'canceled' || status === 'discontinued') return;
        if (indication.toLowerCase() === 'dc') return;

        // Frequency from Col 0
        const orderDetail = cols[0] ? cols[0].trim() : '';
        const freqMatch = orderDetail.match(/\b(Q\d+H|BID|TID|QID|DAILY|OD|QAM|QPM|PRN|ONCE|NOW|STAT)\b/i);
        const frequency = freqMatch ? freqMatch[0].toUpperCase() : '';

        // 24h Count Logic
        let isTaken24h = false;
        if (status === 'taken' && adminTimeStr) {
            // Fix "16:23 PM" format
            // Remove AM/PM if the hour is > 12, or just let Date parse try, but clean it up first.
            let cleanTimeStr = adminTimeStr.trim();

            // If it has " PM" or " AM" and also looks like "HH:MM", let's be careful.
            // Replace "16:23 PM" -> "16:23"
            if (/\d{2}:\d{2}\s+(PM|AM)/i.test(cleanTimeStr)) {
                const parts = cleanTimeStr.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/);
                if (parts) {
                    const h = parseInt(parts[2]);
                    if (h > 12) {
                        cleanTimeStr = cleanTimeStr.replace(/\s*(PM|AM)/i, '');
                    }
                }
            }

            const entryTime = new Date(cleanTimeStr);
            if (!isNaN(entryTime.getTime())) {
                const diff = now - entryTime;
                // 24h = 86400000 ms
                if (diff >= 0 && diff < oneDayMs) {
                    isTaken24h = true;
                }
            }
        }

        let cleanStr = `${name} ${dose} ${unit} ${route}`;
        if (frequency) cleanStr += ` ${frequency}`;
        if (indication && indication.toLowerCase() !== 'dc') cleanStr += ` (For: ${indication})`;

        if (!processedMeds.has(name)) {
            processedMeds.set(name, {
                text: cleanStr,
                count24h: isTaken24h ? 1 : 0
            });
        } else {
            const data = processedMeds.get(name);
            if (isTaken24h) {
                data.count24h += 1;
            }
        }
    });

    // 2. Decide: If we found nothing smart, return to allow Default Paste
    if (processedMeds.size === 0) {
        return;
    }

    // 3. If matches found, Prevent Default and insert Smart Text
    e.preventDefault();

    const finalOutput = Array.from(processedMeds.values()).map(item => {
        let str = item.text;
        if (item.count24h > 0) {
            str += ` [Taken ${item.count24h}x in 24h]`;
        }
        return str;
    }).join('\n');

    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;

    if (currentVal.trim() === '') {
        textarea.value = finalOutput;
    } else {
        textarea.value = currentVal.substring(0, start) + finalOutput + currentVal.substring(end);
    }

    triggerSave();
}

function closeModal() {
    const modal = document.getElementById('patient-modal');
    const panel = document.getElementById('modal-panel');
    panel.classList.add('translate-x-full');
    setTimeout(() => {
        modal.classList.add('hidden');
        if (appData.currentWard) renderPatientsGrid(appData.wards[appData.currentWard]);
    }, 300);
}

function renderModalLabs(labs) {
    const container = document.getElementById('modal-labs-grid');
    if (!container) return;
    container.innerHTML = '';

    // Grid Layout Restoration
    container.className = "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2";

    // Robust parsing for Labs
    if (typeof labs === 'string') {
        try { labs = JSON.parse(labs); } catch (e) { labs = {}; }
    }
    if (!labs || typeof labs !== 'object' || Array.isArray(labs)) {
        labs = {};
    }

    // Ghost Value Logic for Labs
    let historyLabs = {};
    if (appData.currentPatient.history_labs) {
        try {
            if (typeof appData.currentPatient.history_labs === 'string') {
                historyLabs = JSON.parse(appData.currentPatient.history_labs);
            } else {
                historyLabs = appData.currentPatient.history_labs;
            }
        } catch (e) {
            console.warn("Failed to parse history labs", e);
        }
    }

    try {
        // 1. Render Default Labs
        // Merge keys from defaults and current labs to ensure we show everything
        const allKeys = new Set([...Object.keys(appData.ranges), ...Object.keys(labs)]);

        // Filter out keys that are NOT in ranges (handle Custom labs separately)
        const standardKeys = Object.keys(appData.ranges);

        standardKeys.forEach(key => {
            const lData = labs[key] || { value: '', unit: '' };
            const val = lData.value;
            const [min, max] = appData.ranges[key];

            // Ghost Value
            let ghostVal = '';
            if ((!val || val === '') && historyLabs[key] && historyLabs[key].value) {
                ghostVal = historyLabs[key].value;
            }

            // Status Logic
            let statusClass = "text-indigo-900 border-indigo-200 focus:border-indigo-500";
            let statusIcon = "";

            if (val !== '') {
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    if (num < min) { statusClass = "text-blue-600 border-blue-400 bg-blue-50 font-bold"; statusIcon = "↓"; }
                    else if (num > max) { statusClass = "text-red-600 border-red-400 bg-red-50 font-bold"; statusIcon = "↑"; }
                    else { statusClass = "text-emerald-600 border-emerald-400 bg-emerald-50"; statusIcon = "✓"; }
                }
            }

            const wrapper = document.createElement('div');
            wrapper.className = `p-2 rounded-lg border border-slate-200 bg-white flex flex-col items-center justify-between text-center transition-all hover:shadow-md h-20`;

            wrapper.innerHTML = `
                <label class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">${key}</label>
                <div class="relative w-full">
                    <input type="text" value="${val}" 
                        class="w-full text-center bg-transparent text-lg font-black focus:outline-none p-0 border-b transition-colors ${statusClass}" 
                        placeholder="${ghostVal ? '(' + ghostVal + ')' : '-'}"
                        onfocus="this.placeholder = ''"
                        onblur="this.placeholder = '${ghostVal ? '(' + ghostVal + ')' : '-'}'">
                    <span class="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold ${statusClass.includes('red') ? 'text-red-500' : 'text-slate-400'}">${statusIcon}</span>
                </div>
                <span class="text-[9px] text-slate-300">${min}-${max}</span>
            `;

            const input = wrapper.querySelector('input');
            input.oninput = (e) => {
                if (!appData.currentPatient.labs) appData.currentPatient.labs = {};
                if (!appData.currentPatient.labs[key]) appData.currentPatient.labs[key] = { value: '', unit: '' };
                appData.currentPatient.labs[key].value = e.target.value;

                // Live Validation styling update
                // (Re-render whole block is expensive, better toggle classes here if needed, but for now triggerSave is enough)
                triggerSave();
            };

            container.appendChild(wrapper);
        });

        // 2. Custom Labs
        const customKeys = Object.keys(labs).filter(k => !standardKeys.includes(k));

        customKeys.forEach(key => {
            // Safety check: skip if value is null/undefined or not object
            if (!labs[key] || typeof labs[key] !== 'object') return;

            const val = labs[key].value || '';

            // Ghost for custom labs?
            let ghostVal = '';
            if ((!val || val === '') && historyLabs[key] && historyLabs[key].value) {
                ghostVal = historyLabs[key].value;
            }

            const wrapper = document.createElement('div');
            wrapper.className = `p-2 rounded-lg border border-indigo-200 bg-indigo-50 flex flex-col items-center justify-between text-center transition-all hover:shadow-md h-20 relative group`;

            wrapper.innerHTML = `
                <div class="absolute -top-2 -right-2 hidden group-hover:block z-20">
                    <button class="bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] shadow-sm hover:scale-110 transition-transform btn-delete-lab">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <input type="text" value="${key}" class="text-[10px] uppercase font-black tracking-tight text-indigo-700 bg-transparent border-none focus:ring-0 p-0 w-full text-center placeholder-indigo-300 mb-0.5" placeholder="NAME">
                <input type="text" value="${val}" 
                    class="w-full text-center bg-transparent text-lg font-black focus:outline-none p-0 border-b border-indigo-200 focus:border-indigo-500 transition-colors text-indigo-900" 
                    placeholder="${ghostVal ? '(' + ghostVal + ')' : 'Val'}">
            `;

            // Logic to Handle Rename and Value Change
            const inputs = wrapper.querySelectorAll('input');
            const nameInput = inputs[0];
            const valInput = inputs[1];
            const deleteBtn = wrapper.querySelector('.btn-delete-lab');

            if (!nameInput || !valInput || !deleteBtn) {
                console.warn("Missing elements for custom lab:", key);
                return;
            }

            // Delete
            deleteBtn.onclick = () => {
                if (confirm(`Remove ${key}?`)) {
                    delete appData.currentPatient.labs[key];
                    triggerSave();
                    renderModalLabs(appData.currentPatient.labs);
                }
            };

            // Rename Key
            nameInput.onchange = (e) => {
                const newName = e.target.value.trim().replace(/\s+/g, '_'); // Enforce safe keys
                if (newName && newName !== key) {
                    if (appData.currentPatient.labs[newName]) {
                        alert("Lab name already exists!");
                        e.target.value = key; // Revert
                        return;
                    }
                    // Start of Move
                    appData.currentPatient.labs[newName] = appData.currentPatient.labs[key];
                    delete appData.currentPatient.labs[key];
                    triggerSave();
                    renderModalLabs(appData.currentPatient.labs);
                }
            };

            // Update Value
            valInput.onchange = (e) => {
                appData.currentPatient.labs[key].value = e.target.value;
                triggerSave();
            };

            container.appendChild(wrapper);
        });

        // 3. "Add Lab" Button
        const addBtn = document.createElement('button');
        addBtn.className = "flex flex-col items-center justify-center p-2 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-medical-400 hover:text-medical-600 hover:bg-slate-50 transition-all h-20";
        addBtn.innerHTML = `
            <i class="fa-solid fa-plus text-lg mb-1"></i>
            <span class="text-[10px] font-bold uppercase">Add</span>
        `;
        addBtn.onclick = () => {
            const newKey = "New_Lab_" + Math.floor(Math.random() * 1000);
            if (!appData.currentPatient.labs) appData.currentPatient.labs = {};
            appData.currentPatient.labs[newKey] = { value: '', unit: '' };
            renderModalLabs(appData.currentPatient.labs);
            triggerSave();
        };
        container.appendChild(addBtn);

    } catch (err) {
        console.error("Critical renderModalLabs error:", err);
        alert("UI Error: " + err.message);
    }
}

function renderModalSymptoms(symptoms) {
    const container = document.getElementById('modal-symptoms-grid');
    if (!container) return;
    container.innerHTML = '';

    // Robust parsing
    if (typeof symptoms === 'string') {
        try { symptoms = JSON.parse(symptoms); } catch (e) { symptoms = {}; }
    }
    if (!symptoms || typeof symptoms !== 'object' || Array.isArray(symptoms)) {
        symptoms = {};
    }

    // Ghost Value Logic
    let historySyms = {};
    if (appData.currentPatient.history_symptoms) {
        try {
            if (typeof appData.currentPatient.history_symptoms === 'string') {
                historySyms = JSON.parse(appData.currentPatient.history_symptoms);
            } else {
                historySyms = appData.currentPatient.history_symptoms;
            }
        } catch (e) {
            console.warn("Failed to parse history symptoms", e);
        }
    }

    const possibleSymptoms = [
        "Pain", "Fatigue (Tiredness)", "Drowsiness", "Nausea", "Vomiting",
        "Lack of Appetite", "Shortness of Breath (Dyspnea)", "Depression",
        "Anxiety", "Sleep Disturbance", "Dysphagia", "Odynophagia",
        "Constipation", "Diarrhea", "Confusion/Delirium",
        "Peripheral Neuropathy", "Mucositis", "Wellbeing"
    ];

    // 1. Render Standard Symptoms
    possibleSymptoms.forEach(sym => {
        const sData = symptoms[sym] || { active: false, note: '' };
        const isActive = sData.active;
        const baseClass = isActive ? 'bg-rose-500 text-white shadow-md shadow-rose-200' : 'bg-white border border-slate-200 text-slate-800 hover:border-rose-300';

        // Check for Ghost Value
        let ghostHTML = '';
        if (!isActive && historySyms[sym] && historySyms[sym].active) {
            const histNote = historySyms[sym].note ? `: ${historySyms[sym].note}` : '';
            ghostHTML = `<span class="text-[9px] text-slate-400 font-normal italic mt-1 block">(Yest: Active${histNote})</span>`;
        }

        const btn = document.createElement('div');
        btn.className = `${baseClass} p-2 rounded-lg transition-all duration-200 cursor-pointer flex flex-col gap-1 min-h-[4.5rem] relative overflow-hidden`;

        btn.innerHTML = `
            <div class="flex justify-between items-center w-full z-10">
                <span class="font-bold text-xs uppercase tracking-wide select-none leading-tight">${sym}</span>
                ${isActive ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
            </div>
            ${isActive
                ? `<input type="text" value="${sData.note}" placeholder="Note..." class="w-full text-[10px] bg-white/20 text-white placeholder-white/70 border-none rounded px-2 py-1 focus:ring-1 focus:ring-white/50 focus:outline-none transition-colors z-10" onclick="event.stopPropagation()">`
                : ghostHTML
            }
        `;

        btn.onclick = (e) => {
            if (e.target.tagName === 'INPUT') return;

            if (!appData.currentPatient.symptoms) appData.currentPatient.symptoms = {};
            if (!appData.currentPatient.symptoms[sym]) appData.currentPatient.symptoms[sym] = { active: false, note: '' };

            appData.currentPatient.symptoms[sym].active = !appData.currentPatient.symptoms[sym].active;
            renderModalSymptoms(appData.currentPatient.symptoms);
            triggerSave();
        };

        const input = btn.querySelector('input');
        if (input) {
            input.oninput = (e) => {
                appData.currentPatient.symptoms[sym].note = e.target.value;
                triggerSave();
            };
        }
        container.appendChild(btn);
    });

    // 2. Render Custom Symptoms
    if (!symptoms) symptoms = {};
    const customKeys = Object.keys(symptoms).filter(k => !possibleSymptoms.includes(k));

    customKeys.forEach(key => {
        const sData = symptoms[key];
        const isActive = sData.active; // Allow toggling

        // Match standard styles
        const baseClass = isActive ? 'bg-rose-500 text-white shadow-md shadow-rose-200' : 'bg-white border border-slate-200 text-slate-800 hover:border-rose-300';
        const inputNameClass = isActive ? 'text-white placeholder-white/60' : 'text-slate-900 placeholder-slate-400 font-bold';
        const inputNoteClass = isActive ? 'bg-white/20 text-white placeholder-white/70' : 'bg-slate-50 text-slate-700 border border-slate-200 placeholder-slate-400';

        const btn = document.createElement('div');
        btn.className = `${baseClass} p-2 rounded-lg transition-all duration-200 cursor-pointer flex flex-col gap-1 relative group min-h-[4.5rem]`;

        btn.innerHTML = `
            <div class="absolute -top-2 -right-2 hidden group-hover:block z-10">
                <button class="bg-slate-800 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] shadow-md hover:bg-red-600 transition-colors btn-delete-sym">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="flex justify-between items-center w-full">
                <input type="text" value="${key}" class="font-bold text-xs uppercase tracking-wide bg-transparent border-none p-0 focus:ring-0 w-full ${inputNameClass} transition-colors" placeholder="SYMPTOM NAME" onclick="event.stopPropagation()">
                ${isActive ? '<i class="fa-solid fa-check text-xs"></i>' : '<i class="fa-solid fa-pen text-[9px] opacity-20"></i>'}
            </div>
            ${isActive ? `<input type="text" value="${sData.note || ''}" placeholder="Note..." class="w-full text-[10px] border-none rounded px-2 py-1 focus:ring-1 focus:ring-white/50 focus:outline-none ${inputNoteClass}" onclick="event.stopPropagation()">` : ''}
        `;

        // Logic
        const nameInput = btn.querySelector('input[type="text"]:first-child');
        const noteInput = btn.querySelector('input[type="text"]:last-child');
        const deleteBtn = btn.querySelector('.btn-delete-sym');

        // Toggle Active Logic (Container Click)
        btn.onclick = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.closest('button')) return;
            appData.currentPatient.symptoms[key].active = !appData.currentPatient.symptoms[key].active;
            renderModalSymptoms(appData.currentPatient.symptoms);
            triggerSave();
        };

        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete symptom '${key}'?`)) {
                delete appData.currentPatient.symptoms[key];
                triggerSave();
                renderModalSymptoms(appData.currentPatient.symptoms);
            }
        };

        nameInput.onchange = (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== key) {
                if (appData.currentPatient.symptoms[newName]) {
                    alert("Symptom already exists!");
                    e.target.value = key;
                    return;
                }
                // Preserve active state and note
                const currentData = appData.currentPatient.symptoms[key];
                appData.currentPatient.symptoms[newName] = currentData;
                delete appData.currentPatient.symptoms[key];
                triggerSave();
                renderModalSymptoms(appData.currentPatient.symptoms);
            }
        };

        if (noteInput && isActive) {
            noteInput.oninput = (e) => {
                appData.currentPatient.symptoms[key].note = e.target.value;
                triggerSave();
            };
        }

        container.appendChild(btn);
    });

    // 3. Add Symptom Button
    const addBtn = document.createElement('div');
    addBtn.className = "border-2 border-dashed border-slate-300 rounded-lg p-2 flex flex-col items-center justify-center cursor-pointer hover:border-medical-400 hover:bg-slate-50 transition-colors min-h-[4.5rem] text-slate-400 hover:text-medical-600";
    addBtn.innerHTML = `
        <i class="fa-solid fa-plus text-lg mb-1"></i>
        <span class="text-[10px] font-bold uppercase">Add</span>
    `;
    addBtn.onclick = () => {
        const newKey = "New_Symptom_" + Math.floor(Math.random() * 1000);
        if (!appData.currentPatient.symptoms) appData.currentPatient.symptoms = {};
        appData.currentPatient.symptoms[newKey] = { active: true, note: '' };
        renderModalSymptoms(appData.currentPatient.symptoms);
        triggerSave();
    };
    container.appendChild(addBtn);

}

function triggerSave() {
    const status = document.getElementById('save-status');
    status.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-blue-500 mr-1"></i> Saving...';

    if (appData.currentPatient) {
        // Only scrape DOM if the Patient Modal is actually open
        const modal = document.getElementById('patient-modal');
        if (modal && !modal.classList.contains('hidden')) {
            // Read Header Fields
            appData.currentPatient.name = document.getElementById('modal-patient-name').value || appData.currentPatient.name;
            appData.currentPatient.code = document.getElementById('modal-patient-code').value || appData.currentPatient.code;
            appData.currentPatient.age = document.getElementById('modal-patient-age').value || appData.currentPatient.age;
            appData.currentPatient.room = document.getElementById('modal-patient-room').value || appData.currentPatient.room;

            appData.currentPatient.diagnosis = document.getElementById('inp-diagnosis').value || appData.currentPatient.diagnosis;
            appData.currentPatient.provider = document.getElementById('inp-provider').value || appData.currentPatient.provider;
            appData.currentPatient.treatment = document.getElementById('inp-treatment').value || appData.currentPatient.treatment;

            // Save Medications as JSON
            const medsObj = {
                regular: document.getElementById('inp-medications-regular').value,
                prn: document.getElementById('inp-medications-prn').value
            };
            appData.currentPatient.medications = JSON.stringify(medsObj);

            appData.currentPatient.notes = document.getElementById('inp-notes').value || appData.currentPatient.notes;
        }
    }

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToBackend, 1500);
}

async function saveToBackend() {
    if (GAS_API_URL.includes("Paste_Your")) {
        console.warn("No GAS URL configured, not saving.");
        document.getElementById('save-status').innerText = 'Not Saved (Configure URL)';
        return;
    }

    if (!appData.currentPatient) return;

    try {
        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appData.currentPatient)
        });

        const status = document.getElementById('save-status');
        status.innerHTML = '<i class="fa-solid fa-check text-green-500 mr-1"></i> Saved';
        document.getElementById('last-edited').innerText = 'Last saved: ' + new Date().toLocaleTimeString();

    } catch (e) {
        console.error("Save failed", e);
        document.getElementById('save-status').innerText = 'Save Failed!';
    }
}


// ----- IMPORT LOGIC -----

let csvData = [];
let csvHeaders = [];

function openImportModal() {
    document.getElementById('import-modal').classList.remove('hidden');
    // Reset state
    document.getElementById('import-step-1').classList.remove('hidden');
    document.getElementById('import-step-2').classList.add('hidden');
    document.getElementById('import-step-3').classList.add('hidden');
    document.getElementById('import-footer').classList.remove('hidden'); // Reset footer visibility
    document.getElementById('btn-start-import').disabled = true;
    document.getElementById('btn-start-import').classList.add('cursor-not-allowed', 'bg-slate-300');
    document.getElementById('btn-start-import').classList.remove('bg-medical-600', 'hover:bg-medical-700');
    document.getElementById('paste-input').value = "";

    // Also reset Paste Button
    const btnParams = document.getElementById('btn-process-paste');
    if (btnParams) {
        btnParams.disabled = true;
        btnParams.classList.add('cursor-not-allowed', 'bg-slate-200', 'text-slate-400');
        btnParams.classList.remove('bg-medical-600', 'text-white', 'hover:bg-medical-700');
    }
}

function closeImportModal() {
    document.getElementById('import-modal').classList.add('hidden');
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;


    if (file.name.endsWith('.csv')) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                csvData = results.data;
                csvHeaders = results.meta.fields;
                showMappingStep();
            },
            error: function (err) {
                alert("Error parsing CSV: " + err.message);
            }
        });
    } else if (file.name.match(/\.xlsx?$|\.xls$/)) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (json.length === 0) {
                alert("Excel file is empty");
                return;
            }

            const headers = json[0];
            const rows = json.slice(1);

            csvHeaders = headers;
            csvData = rows.map(row => {
                let obj = {};
                headers.forEach((h, i) => {
                    obj[h] = row[i];
                });
                return obj;
            });

            showMappingStep();
        };
        reader.readAsArrayBuffer(file);
    } else {
        alert("Unsupported file format. Please use .csv or .xlsx");
    }
}

function checkPasteInput() {
    const val = document.getElementById('paste-input').value;
    const btn = document.getElementById('btn-process-paste');
    if (val && val.trim().length > 0) {
        btn.disabled = false;
        btn.classList.remove('bg-slate-200', 'text-slate-400', 'cursor-not-allowed');
        btn.classList.add('bg-medical-600', 'text-white', 'hover:bg-medical-700');
    } else {
        btn.disabled = true;
        btn.classList.add('bg-slate-200', 'text-slate-400', 'cursor-not-allowed');
        btn.classList.remove('bg-medical-600', 'text-white', 'hover:bg-medical-700');
    }
}

function handlePaste() {
    let rawData = document.getElementById('paste-input').value;
    if (!rawData) return;

    rawData = rawData.trim();
    const isTabSeparated = rawData.includes('\t');

    Papa.parse(rawData, {
        header: true,
        skipEmptyLines: 'greedy',
        delimiter: isTabSeparated ? "\t" : "",
        complete: function (results) {
            if (results.data && results.data.length > 0) {
                const messyHeaders = results.meta.fields || [];
                csvHeaders = messyHeaders.filter(h => h && h.trim() !== "");

                csvData = results.data.map(row => {
                    const cleanRow = {};
                    csvHeaders.forEach(h => {
                        cleanRow[h] = row[h];
                    });
                    return cleanRow;
                });

                if (csvHeaders.length === 0) {
                    alert("Could not detect any valid headers. Please ensure the first row contains header names.");
                    return;
                }

                showMappingStep();
            } else {
                alert("Could not parse data. Ensure you pasted a table with headers.");
            }
        },
        error: function (err) {
            alert("Error parsing: " + err.message);
        }
    });
}

function showMappingStep() {
    document.getElementById('import-step-1').classList.add('hidden');
    document.getElementById('import-step-2').classList.remove('hidden');

    document.getElementById('btn-start-import').disabled = false;
    document.getElementById('btn-start-import').classList.remove('cursor-not-allowed', 'bg-slate-300');
    document.getElementById('btn-start-import').classList.add('bg-medical-600', 'hover:bg-medical-700');

    renderMappingTable();
}

function renderMappingTable() {
    const tbody = document.getElementById('mapping-table-body');
    tbody.innerHTML = '';

    const appFields = [
        { key: 'name', label: 'Patient Name', aliases: ['patient name', 'name', 'full name'] },
        { key: 'code', label: 'Patient Code/ID', aliases: ['patient code', 'code', 'id', 'mrn', 'file no'] },
        { key: 'ward', label: 'Ward Name', aliases: ['ward', 'unit', 'location'] },
        { key: 'room', label: 'Room Number', aliases: ['room', 'bed'] },
        { key: 'age', label: 'Age', aliases: ['age', 'dob'] },
        { key: 'diagnosis', label: 'Diagnosis', aliases: ['diagnosis', 'cause of admission', 'admission reason', 'dx'] },
        { key: 'provider', label: 'Provider', aliases: ['provider', 'physician', 'doctor', 'consultant'] },
        { key: 'treatment', label: 'Treatment', aliases: ['treatment', 'plan', 'rx'] },
        { key: 'medications', label: 'Medication List', aliases: ['medications', 'meds', 'medication list', 'drugs'] }
    ];

    appFields.forEach(field => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50";

        let selectedHeader = "";
        const lowerLabel = field.label.toLowerCase();
        const lowerKey = field.key.toLowerCase();
        const aliases = field.aliases || [];

        // Find best match in CSV headers
        csvHeaders.forEach(h => {
            const lowerH = h.toLowerCase();

            // 1. Exact Match
            if (lowerH === lowerKey || lowerH === lowerLabel) {
                selectedHeader = h;
                return;
            }

            // 2. Alias Match (Word Boundary)
            // prevent "id" matching "provider"
            if (aliases.some(a => {
                // Escape special regex chars if any
                const escapedAlias = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(^|[^a-z0-9])${escapedAlias}([^a-z0-9]|$)`, 'i');
                return regex.test(lowerH);
            })) {
                selectedHeader = h;
            }
        });

        const options = csvHeaders.map(h => `<option value="${h}" ${h === selectedHeader ? 'selected' : ''}>${h}</option>`).join('');

        tr.innerHTML = `
            <td class="px-4 py-3 font-medium text-slate-700">${field.label}</td>
            <td class="px-4 py-3">
                <select class="w-full bg-white border border-slate-200 rounded-lg text-sm p-2 focus:ring-2 focus:ring-medical-500 outline-none map-select" data-field="${field.key}">
                    <option value="">(Skip)</option>
                    ${options}
                </select>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function startImport() {
    document.getElementById('import-step-2').classList.add('hidden');
    document.getElementById('import-step-3').classList.remove('hidden');
    document.getElementById('import-footer').classList.add('hidden');

    const mapping = {};
    document.querySelectorAll('.map-select').forEach(select => {
        if (select.value) {
            mapping[select.dataset.field] = select.value;
        }
    });

    const newPatients = csvData.map(row => {
        const p = {};
        Object.keys(mapping).forEach(key => {
            p[key] = row[mapping[key]];
        });

        // Context Aware: Ward
        if ((!p.ward || p.ward === '') && appData.currentWard && appData.currentWard !== 'Unassigned') {
            p.ward = appData.currentWard;
        }

        p.id = Date.now().toString() + Math.random().toString().slice(2, 5);
        p.labs = p.labs || {};
        p.symptoms = p.symptoms || {};
        p.notes = p.notes || "";
        return p;
    });

    document.getElementById('import-status-text').innerText = `Uploading ${newPatients.length} patients...`;

    try {
        const payload = {
            action: 'import',
            patients: newPatients
        };

        // DEBUG: Check payload
        console.log("Payload:", payload);

        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors', // <--- This often hides errors. 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Since mode is no-cors, we can't read the response text.
        // We rely on the request passing through.

        document.getElementById('import-status-text').innerText = "Processing on server...";
        await new Promise(r => setTimeout(r, 2000));

        alert("Import sent to server! Refresh the page in a few seconds to see changes.\n(If empty, check headers in Sheet)");
        closeImportModal();
        fetchData();

    } catch (e) {
        alert("Import Failed: " + e.message);
        closeImportModal();
    }
}

// Medication Quick View Logic
function openMedicationModal(patient) {
    const modal = document.getElementById('medication-modal');

    // Elements
    const listRegular = document.getElementById('medication-list-regular');
    const listPrn = document.getElementById('medication-list-prn');
    // Updated IDs to match new Wide Modal HTML
    const noRegMsg = document.getElementById('no-reg-meds-msg');
    const noPrnMsg = document.getElementById('no-prn-meds-msg');

    const nameEl = document.getElementById('med-modal-patient-name');
    if (nameEl) nameEl.innerText = patient.name;

    listRegular.innerHTML = '';
    listPrn.innerHTML = '';

    // Parse Data
    let meds = { regular: '', prn: '' };
    if (patient.medications && typeof patient.medications === 'object') {
        meds = patient.medications;
    } else {
        try {
            if (patient.medications && typeof patient.medications === 'string' && patient.medications.trim().startsWith('{')) {
                meds = JSON.parse(patient.medications);
            } else {
                meds.regular = patient.medications || '';
            }
        } catch (e) {
            meds.regular = patient.medications || '';
        }
    }

    // Helper to render list
    // Helper to render list
    const renderList = (text) => {
        if (!text) return '<p class="text-gray-400 text-sm italic">None</p>';
        return text.split('\n').filter(t => t.trim()).map(item => {
            // Extract [Taken Nx...] if present
            const takenMatch = item.match(/\[Taken\s+(\d+x)\s+in\s+24h\]/i);
            const isTaken = !!takenMatch;
            let displayText = item;
            let takenBadge = '';

            if (isTaken) {
                // Remove the raw tag from text to display it separately
                displayText = item.replace(takenMatch[0], '').trim();
                const count = takenMatch[1]; // e.g., "4x"

                // Create a prominent badge
                takenBadge = `
                    <div class="flex items-center gap-1 bg-white/80 border border-red-200 px-2 py-1 rounded-md shadow-sm ml-2">
                        <i class="fas fa-history text-red-500 text-xs"></i>
                        <span class="text-red-600 font-bold text-xs uppercase tracking-wider">${count} in 24h</span>
                    </div>
                `;
            }

            // Base classes
            let classes = "p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all";
            let dotClass = "w-2 h-2 rounded-full mt-1.5 sm:mt-0 flex-shrink-0";

            if (isTaken) {
                classes += " bg-red-50 border-red-200 text-gray-800 shadow-sm";
                dotClass += " bg-red-500 animate-pulse";
            } else {
                classes += " bg-slate-50 border-slate-100 text-gray-600";
                dotClass += " bg-indigo-400";
            }

            return `
            <li class="${classes}">
                <div class="flex items-start sm:items-center gap-2 flex-1">
                    <div class="${dotClass}"></div>
                    <span class="text-sm leading-relaxed font-medium">${displayText}</span>
                </div>
                ${takenBadge}
            </li>`;
        }).join('');
    };

    document.getElementById('medication-list-regular').innerHTML = `<ul class="space-y-2">${renderList(meds.regular)}</ul>`;
    document.getElementById('medication-list-prn').innerHTML = `<ul class="space-y-2">${renderList(meds.prn)}</ul>`;

    // Hide/show empty messages based on content
    if (meds.regular && meds.regular.trim() !== '') {
        noRegMsg.classList.add('hidden');
    } else {
        noRegMsg.classList.remove('hidden');
    }

    if (meds.prn && meds.prn.trim() !== '') {
        noPrnMsg.classList.add('hidden');
    } else {
        noPrnMsg.classList.remove('hidden');
    }

    // Default to 'Regular' tab on mobile
    switchMedTab('regular');
    modal.classList.remove('hidden');
}

function switchMedTab(tab) {
    const btnReg = document.getElementById('tab-btn-regular');
    const btnPrn = document.getElementById('tab-btn-prn');
    const colReg = document.getElementById('med-col-regular');
    const colPrn = document.getElementById('med-col-prn');

    // Reset Styles
    const activeBtnClass = "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50";
    const inactiveBtnClass = "text-slate-500 hover:bg-slate-50";

    if (tab === 'regular') {
        // Show Regular, Hide PRN (on mobile)
        colReg.classList.remove('hidden');
        colPrn.classList.add('hidden');

        // Update Buttons
        btnReg.className = "flex-1 py-3 text-sm font-bold transition-colors " + activeBtnClass;
        btnPrn.className = "flex-1 py-3 text-sm font-bold transition-colors " + inactiveBtnClass;
    } else {
        // Show PRN, Hide Regular (on mobile)
        colReg.classList.add('hidden');
        colPrn.classList.remove('hidden');

        // Update Buttons
        btnReg.className = "flex-1 py-3 text-sm font-bold transition-colors " + inactiveBtnClass;
        btnPrn.className = "flex-1 py-3 text-sm font-bold transition-colors " + activeBtnClass;
    }
}

function closeMedicationModal() {
    document.getElementById('medication-modal').classList.add('hidden');
}

// Opioid Conversion Logic
const OPIOID_FACTORS = {
    'morphine': { po: 1, iv: 3 },
    'oxycodone': { po: 1.5, iv: null },
    'hydromorphone': { po: 4, iv: 20 },
    'codeine': { po: 0.15, iv: null },
    'tramadol': { po: 0.1, iv: 0.1 },
    'fentanyl_td': { po: 2.4, iv: null }
};

function openCalculatorModal() {
    document.getElementById('calculator-modal').classList.remove('hidden');
}

function closeCalculatorModal() {
    document.getElementById('calculator-modal').classList.add('hidden');
}

function calculateOpioid() {
    const fromDrug = document.getElementById('calc-from-drug').value;
    const fromRoute = document.getElementById('calc-from-route').value;
    const dose = parseFloat(document.getElementById('calc-dose').value);
    const toDrug = document.getElementById('calc-to-drug').value;
    const toRoute = document.getElementById('calc-to-route').value;
    const applyReduction = document.getElementById('calc-apply-reduction').checked;

    if (isNaN(dose) || dose <= 0) {
        document.getElementById('calc-result').innerText = "Enter Dose";
        return;
    }

    // 1. Convert to Daily MME
    let mme = 0;
    const factors = OPIOID_FACTORS[fromDrug];

    if (!factors) return;

    if (fromDrug === 'fentanyl_td') {
        mme = dose * 2.4;
    } else {
        const factor = factors[fromRoute] || factors['po'] || 1; // Added fallback
        mme = dose * factor;
    }

    // 2. Reduction
    if (applyReduction) {
        mme = mme * 0.75;
    }

    // 3. To Target
    const targetFactors = OPIOID_FACTORS[toDrug];
    let result = 0;

    if (targetFactors) {
        // Ensure toRoute is valid for the target drug, else fallback to 'po' or first available key
        let targetFactor = targetFactors[toRoute];
        if (targetFactor === undefined || targetFactor === null) {
            targetFactor = targetFactors['po'] || Object.values(targetFactors)[0];
        }

        if (targetFactor) {
            result = mme / targetFactor;
        }
    }

    document.getElementById('calc-result').innerText = Math.round(result) + " mg"; // Rounding for cleaner UI
    document.getElementById('calc-reduction').innerText = applyReduction ? "-25%" : "0%";
}

// --------------------------------------------------------
// DAILY ROUNDS LOGIC
// --------------------------------------------------------
async function triggerDailyReset() {
    if (!confirm("⚠️ Are you sure you want to START A NEW DAY?\n\nThis will:\n1. Archive all current data to History Log.\n2. Reset Daily Symptoms & Labs for all patients.\n3. Keep Profiles & Meds intact.\n\nThis action cannot be undone from the app.")) {
        return;
    }

    const btn = document.querySelector('button[onclick="triggerDailyReset()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;
    btn.disabled = true;

    try {
        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'reset_day' })
        });
        const json = await res.json();

        if (json.status === 'success') {
            alert(`✅ New Day Started Successfully!\n${json.archived_count} records archived.`);
            closeSettingsModal();
            location.reload(); // Reload to fetch clear data
        } else {
            throw new Error(json.error || "Unknown Error");
        }

    } catch (e) {
        alert("❌ Error Starting New Day: " + e.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Settings & Theming Logic
const currentSettings = {
    theme: localStorage.getItem('app_theme') || 'light',
    accent: localStorage.getItem('app_accent') || 'blue',
    design: localStorage.getItem('app_design') || 'default',
    animations: localStorage.getItem('app_animations') !== 'false'
};

// Init Settings
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentSettings.theme);
    applyAccent(currentSettings.accent);
    applyDesign(currentSettings.design);
    applyAnimations(currentSettings.animations);
});

function openSettingsModal() {
    document.getElementById('settings-modal').classList.remove('hidden');
    updateSettingsUI();
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function updateSettingsUI() {
    // Highlight Active Theme
    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.dataset.theme === currentSettings.theme) {
            btn.classList.add('border-medical-500', 'bg-blue-50');
        } else {
            btn.classList.remove('border-medical-500', 'bg-blue-50');
        }
    });

    // Highlight Active Design
    document.querySelectorAll('.design-btn').forEach(btn => {
        if (btn.dataset.design === currentSettings.design) {
            btn.classList.add('border-medical-500', 'bg-slate-100');
        } else {
            btn.classList.remove('border-medical-500', 'bg-slate-100');
        }
    });

    // Toggle Switch logic...

    // Toggle Switch
    const toggle = document.getElementById('btn-anim-toggle');
    const knob = toggle.querySelector('div');
    if (currentSettings.animations) {
        toggle.classList.add('bg-medical-500', 'bg-green-500'); // ensuring green
        toggle.classList.remove('bg-slate-300');
        knob.classList.add('translate-x-6');
    } else {
        toggle.classList.remove('bg-medical-500', 'bg-green-500');
        toggle.classList.add('bg-slate-300');
        knob.classList.remove('translate-x-6');
    }
}

function setTheme(mode) {
    currentSettings.theme = mode;
    localStorage.setItem('app_theme', mode);
    applyTheme(mode);
    updateSettingsUI();
}

function applyTheme(mode) {
    if (mode === 'dark') {
        document.body.classList.add('theme-dark');
    } else {
        document.body.classList.remove('theme-dark');
    }
}

function setAccent(color) {
    currentSettings.accent = color;
    localStorage.setItem('app_accent', color);
    applyAccent(color);
}

function applyAccent(color) {
    const root = document.documentElement;
    const colors = {
        'blue': { primary: '#0ea5e9', dark: '#0284c7' }, // Sky-500/600
        'teal': { primary: '#14b8a6', dark: '#0d9488' }, // Teal-500/600
        'rose': { primary: '#f43f5e', dark: '#e11d48' }, // Rose-500/600
        'indigo': { primary: '#6366f1', dark: '#4f46e5' }  // Indigo-500/600
    };

    const selected = colors[color] || colors['blue'];
    root.style.setProperty('--color-primary', selected.primary);
    root.style.setProperty('--color-primary-dark', selected.dark);

    // Also update theme buttons UI
    document.querySelectorAll('.theme-btn').forEach(btn => {
        // Optional: Add active ring color based on accent
    });
}

function toggleAnimations() {
    currentSettings.animations = !currentSettings.animations;
    localStorage.setItem('app_animations', currentSettings.animations);
    applyAnimations(currentSettings.animations);
    updateSettingsUI();
}

function applyAnimations(enabled) {
    if (!enabled) {
        document.body.classList.add('no-animations');
    } else {
        document.body.classList.remove('no-animations');
    }
}

// --- 5 Immersive Design System Logic ---

// Icon Mappings for Themes
const THEME_ICONS = {
    'default': { doctor: 'fa-solid fa-user-doctor', meds: 'fa-solid fa-pills' },
    'clay': { doctor: 'fa-solid fa-user-nurse', meds: 'fa-solid fa-tablets' },
    'neon': { doctor: 'fa-solid fa-robot', meds: 'fa-solid fa-capsules' },
    'brutal': { doctor: 'fa-solid fa-user-astronaut', meds: 'fa-solid fa-prescription-bottle' },
    'zen': { doctor: 'fa-solid fa-seedling', meds: 'fa-solid fa-leaf' },
    'glass': { doctor: 'fa-solid fa-user-md', meds: 'fa-solid fa-flask' },
    'win11': { doctor: 'fa-solid fa-user-tie', meds: 'fa-brands fa-windows' }
};

function getThemeIcon(iconType) {
    const design = currentSettings.design || 'default';
    const themeSet = THEME_ICONS[design] || THEME_ICONS['default'];
    return themeSet[iconType] || '';
}

function setDesign(mode) {
    currentSettings.design = mode;
    localStorage.setItem('app_design', mode);
    applyDesign(mode);
    updateSettingsUI();
    renderPatientsGrid(appData.patients); // Re-render for icon changes
}

function applyDesign(mode) {
    // Remove all design classes
    document.body.classList.remove('design-glass', 'design-minimal', 'design-clay', 'design-neon', 'design-brutal', 'design-zen', 'design-win11');

    // Add active class
    if (mode && mode !== 'default') {
        document.body.classList.add(`design-${mode}`);
    }
}

// --- Print Medications Feature ---
function printMedications() {
    // 1. Collect Data by Ward
    const wardsToPrint = {};
    if (Object.keys(appData.wards).length === 0) {
        alert("No patient data available to print.");
        return;
    }

    Object.keys(appData.wards).forEach(wardName => {
        const patients = appData.wards[wardName];
        if (patients && patients.length > 0) {
            wardsToPrint[wardName] = patients;
        }
    });

    if (Object.keys(wardsToPrint).length === 0) {
        alert("No patients found in any ward.");
        return;
    }

    // 2. Generate HTML
    let printContent = `
        <html>
        <head>
            <title>Medication Rounding List - ${new Date().toLocaleDateString()}</title>
            <link rel="stylesheet" href="print_styles.css?v=${Date.now()}">
            <style>
                @media print {
                    @page { size: A4; margin: 1cm; }
                    body { font-family: sans-serif; -webkit-print-color-adjust: exact; }
                    .page-break { page-break-before: always; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
                    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
                    th { background-color: #f1f5f9; font-weight: bold; color: #334155; }
                    .ward-header { 
                        margin-top: 0; 
                        border-bottom: 2px solid #0ea5e9; 
                        margin-bottom: 15px; 
                        padding-bottom: 5px; 
                        color: #0ea5e9; 
                        font-size: 20px; 
                        font-weight: bold; 
                        display: flex;
                        justify-content: space-between;
                        align-items: baseline;
                    }
                    .meta-info { font-size: 10px; color: #64748b; font-weight: normal; }
                    .patient-cell { width: 20%; font-weight: bold; color: #1e293b; }
                    .reg-cell { width: 40%; }
                    .prn-cell { width: 40%; }
                    ul { margin: 0; padding-left: 15px; list-style-type: square; }
                    li { margin-bottom: 2px; }
                    .empty-note { color: #cbd5e1; font-style: italic; font-size: 10px; }
                    tr:nth-child(even) { background-color: #f8fafc; }
                }
            </style>
        </head>
        <body>
    `;

    const wardNames = Object.keys(wardsToPrint);
    wardNames.forEach((ward, index) => {
        if (index > 0) printContent += '<div class="page-break"></div>';

        printContent += `
            <div class="ward-header">
                ${ward}
                <span class="meta-info">Printed: ${new Date().toLocaleString()}</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 25%">Patient</th>
                        <th style="width: 37.5%">Regular Medications</th>
                        <th style="width: 37.5%">PRN Medications</th>
                    </tr>
                </thead>
                <tbody>
        `;

        wardsToPrint[ward].forEach(p => {
            // Parse Meds
            let regularMeds = [];
            let prnMeds = [];

            try {
                if (p.medications && p.medications.trim().startsWith('{')) {
                    const obj = JSON.parse(p.medications);
                    if (obj.regular) regularMeds = obj.regular.split(/\n|,/).filter(m => m.trim());
                    if (obj.prn) prnMeds = obj.prn.split(/\n|,/).filter(m => m.trim());
                } else if (p.medications) {
                    regularMeds = p.medications.split(/\n|,/).filter(m => m.trim());
                }
            } catch (e) {
                if (p.medications) regularMeds = [p.medications];
            }

            const formatList = (list) => {
                if (!list || list.length === 0) return '<span class="empty-note">- None -</span>';
                return `<ul>${list.map(m => `<li>${m.trim()}</li>`).join('')}</ul>`;
            };

            printContent += `
                <tr>
                    <td class="patient-cell">
                        ${p.name}<br>
                        <span style="font-weight:normal; font-size:10px; color:#64748b">
                            ID: ${p.code} | Age: ${parseInt(p.age)}<br>
                            Room: ${p.room}
                        </span>
                    </td>
                    <td class="reg-cell">${formatList(regularMeds)}</td>
                    <td class="prn-cell">${formatList(prnMeds)}</td>
                </tr>
            `;
        });

        printContent += `
                </tbody>
            </table>
        `;
    });

    printContent += `
        </body>
        </html>
    `;

    // 3. Open Print Window
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(printContent);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
        }, 500);
    } else {
        alert("Pop-up blocked! Please allow pop-ups to print.");
    }
}

// --------------------------------------------------------
// DISCHARGE PLAN LOGIC
// --------------------------------------------------------

function openDischargePlanModal() {
    if (!appData.currentPatient) return;

    // 1. Get Medications
    let regularMeds = '';
    let prnMeds = '';

    // Robust extraction similar to openModal
    let medsData = { regular: '', prn: '' };
    if (appData.currentPatient.medications) {
        if (typeof appData.currentPatient.medications === 'object') {
            medsData = appData.currentPatient.medications;
        } else {
            try {
                // If it's a string, try parse it, or fallback to simple string
                if (appData.currentPatient.medications.trim().startsWith('{')) {
                    medsData = JSON.parse(appData.currentPatient.medications);
                } else {
                    medsData.regular = appData.currentPatient.medications || '';
                }
            } catch (e) {
                medsData.regular = appData.currentPatient.medications || '';
            }
        }
    }

    regularMeds = medsData.regular || '';
    prnMeds = medsData.prn || '';

    // Show Loading State
    document.getElementById('discharge-modal').classList.remove('hidden');
    // We need to inject a loading overlay or use existing fields to show loading
    // Let's clear fields and set placeholder "Loading..."
    const fields = ['dp-analgesics', 'dp-antiemetics', 'dp-anxiolytics', 'dp-sleep', 'dp-anticoagulants', 'dp-others'];
    fields.forEach(id => {
        document.getElementById(id).value = "Loading AI analysis...";
        document.getElementById(id).disabled = true;
    });

    const allMedsText = regularMeds + '\n' + prnMeds;

    // AI CALL with Client-Side Fallback
    fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'generate_plan',
            medications: allMedsText
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success' && data.data) {
                const cat = data.data;
                // Populate
                document.getElementById('dp-analgesics').value = Array.isArray(cat.analgesics) ? cat.analgesics.join('\n') : (cat.analgesics || '');
                document.getElementById('dp-anticoagulants').value = Array.isArray(cat.anticoagulants) ? cat.anticoagulants.join('\n') : (cat.anticoagulants || '');
                document.getElementById('dp-antiemetics').value = Array.isArray(cat.antiemetics) ? cat.antiemetics.join('\n') : (cat.antiemetics || '');
                document.getElementById('dp-anxiolytics').value = Array.isArray(cat.anxiolytics) ? cat.anxiolytics.join('\n') : (cat.anxiolytics || '');
                document.getElementById('dp-sleep').value = Array.isArray(cat.sleep) ? cat.sleep.join('\n') : (cat.sleep || '');
                document.getElementById('dp-others').value = Array.isArray(cat.others) ? cat.others.join('\n') : (cat.others || '');
            } else {
                console.warn("AI Backend Error/Old Version:", data);
                runClientSideCategorization(allMedsText);
            }
        })
        .catch(err => {
            console.error("AI Fetch Error (Network/CORS):", err);
            runClientSideCategorization(allMedsText);
        })
        .finally(() => {
            // Enable fields
            fields.forEach(id => {
                if (document.getElementById(id).value === "Loading AI analysis...") document.getElementById(id).value = "";
                document.getElementById(id).disabled = false;
            });
        });

    // Reset Copy Status
    document.getElementById('dp-copy-status').classList.remove('opacity-100');
    document.getElementById('dp-copy-status').classList.add('opacity-0');
}

function closeDischargePlanModal() {
    document.getElementById('discharge-modal').classList.add('hidden');
}

function copyDischargePlan() {
    const analgesics = document.getElementById('dp-analgesics').value.trim();
    const anticoagulants = document.getElementById('dp-anticoagulants').value.trim();
    const antiemetics = document.getElementById('dp-antiemetics').value.trim();
    const anxiolytics = document.getElementById('dp-anxiolytics').value.trim();
    const sleep = document.getElementById('dp-sleep').value.trim();
    const others = document.getElementById('dp-others').value.trim();

    let plan = `PALLIATIVE DISCHARGE MEDICATION PLAN\nfor ${appData.currentPatient ? appData.currentPatient.name : 'Patient'}\n----------------------------------------\n`;

    if (analgesics) plan += `\nANALGESICS (PAIN):\n${analgesics}\n`;
    if (anticoagulants) plan += `\nANTICOAGULANTS (BLOOD THINNERS):\n${anticoagulants}\n`;
    if (antiemetics) plan += `\nANTIEMETICS (NAUSEA/VOMITING):\n${antiemetics}\n`;
    if (anxiolytics) plan += `\nANXIOLYTICS (ANXIETY/RESTLESSNESS):\n${anxiolytics}\n`;
    if (sleep) plan += `\nSLEEP AIDS / SEDATIVES:\n${sleep}\n`;

    if (others) plan += `\nOTHER MEDICATIONS:\n${others}\n`;

    plan += `\n----------------------------------------\nGenerated on ${new Date().toLocaleDateString()}`;

    // Copy to clipboard
    navigator.clipboard.writeText(plan).then(() => {
        const status = document.getElementById('dp-copy-status');
        status.classList.remove('opacity-0');
        status.classList.add('opacity-100');

        setTimeout(() => {
            status.classList.add('opacity-0');
            status.classList.remove('opacity-100');
        }, 3000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert("Failed to copy to clipboard");
    });
}

// Fallback logic
function runClientSideCategorization(text) {
    const lines = text.split('\n');
    const categorized = {
        analgesics: [], antiemetics: [], anxiolytics: [], sleep: [], anticoagulants: [], others: []
    };

    const keywords = {
        analgesics: ['morphine', 'oxycodone', 'hydromorphone', 'fentanyl', 'codeine', 'tramadol', 'methadone', 'paracetamol', 'panadol', 'acetaminophen', 'ibuprofen', 'diclofenac', 'celebrex', 'lyrica', 'pregabalin', 'gabapentin', 'mst', 'sevredol', 'oxynorm', 'targin', 'jurnista', 'durogesic', 'naxyn', 'naproxen', 'optalgin', 'dipyrone', 'perfalgan', 'acamol', 'tramadex', 'tramal', 'percocet', 'oxycontin', 'oxycod', 'fenta', 'rokal'],
        antiemetics: ['metoclopramide', 'plasil', 'primperan', 'ondansetron', 'zofran', 'haloperidol', 'haldol', 'levomepromazine', 'nozinan', 'cyclizine', 'domperidone', 'motilium', 'dexamethasone', 'dexamethazone', 'pramin'],
        anxiolytics: ['midazolam', 'lorazepam', 'ativan', 'diazepam', 'valium', 'alprazolam', 'xanax', 'clonazepam', 'rivotril', 'buspirone', 'midolam', 'assival', 'vaben'],
        sleep: ['zopiclone', 'imovane', 'zolpidem', 'stilnoct', 'melatonin', 'circadin', 'quetiapine', 'seroquel', 'mirtazapine', 'remeron', 'trazodone', 'nocturno', 'bondormin'],
        anticoagulants: ['enoxaparin', 'clexane', 'heparin', 'warfarin', 'coumadin', 'rivaroxaban', 'xarelto', 'apixaban', 'eliquis', 'dabigatran', 'pradaxa', 'aspirin', 'clopidogrel', 'plavix']
    };

    lines.forEach(line => {
        const cleanLine = line.trim();
        if (!cleanLine) return;
        const lower = cleanLine.toLowerCase();
        let matched = false;

        if (keywords.analgesics.some(k => lower.includes(k))) { categorized.analgesics.push(cleanLine); matched = true; }
        else if (keywords.antiemetics.some(k => lower.includes(k))) { categorized.antiemetics.push(cleanLine); matched = true; }
        else if (keywords.anxiolytics.some(k => lower.includes(k))) { categorized.anxiolytics.push(cleanLine); matched = true; }
        else if (keywords.sleep.some(k => lower.includes(k))) { categorized.sleep.push(cleanLine); matched = true; }
        else if (keywords.anticoagulants.some(k => lower.includes(k))) { categorized.anticoagulants.push(cleanLine); matched = true; }

        if (!matched) categorized.others.push(cleanLine);
    });

    document.getElementById('dp-analgesics').value = categorized.analgesics.join('\n');
    document.getElementById('dp-antiemetics').value = categorized.antiemetics.join('\n');
    document.getElementById('dp-anxiolytics').value = categorized.anxiolytics.join('\n');
    document.getElementById('dp-sleep').value = categorized.sleep.join('\n');
    document.getElementById('dp-anticoagulants').value = categorized.anticoagulants.join('\n');
    document.getElementById('dp-others').value = categorized.others.join('\n');
}

// --------------------------------------------------------
// AI COMMAND CENTER LOGIC
// --------------------------------------------------------

function openAIHub() {
    // Requires a patient to be selected (currently opened in modal context or global context)
    // Assuming context is appData.currentPatient

    if (!appData.currentPatient) {
        alert("Please select a patient first.");
        return;
    }

    document.getElementById('ai-patient-name').textContent = appData.currentPatient.name;
    document.getElementById('ai-hub-modal').classList.remove('hidden');

    // Reset View
    document.getElementById('ai-placeholder').classList.remove('hidden');
    document.getElementById('ai-loading').classList.add('hidden');
    document.getElementById('ai-result-container').classList.add('hidden');
    document.getElementById('ai-result-container').innerHTML = "";
}

function closeAIHub() {
    document.getElementById('ai-hub-modal').classList.add('hidden');
}

function triggerAIAction(actionType) {
    if (actionType === 'discharge') {
        // Switch to the other modal
        closeAIHub();
        openDischargePlanModal();
        return;
    }

    // UI State: Loading
    document.getElementById('ai-placeholder').classList.add('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-result-container').classList.add('hidden');

    const actionMap = {
        'summary': 'generate_summary',
        'suggestions': 'generate_suggestions'
    };

    const serverAction = actionMap[actionType];

    // Prepare Data
    // We send the full patient object for context
    const payload = {
        action: serverAction,
        patient: appData.currentPatient
    };

    fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    })
        .then(response => response.json())
        .then(data => {
            // UI State: Result
            document.getElementById('ai-loading').classList.add('hidden');
            document.getElementById('ai-result-container').classList.remove('hidden');

            if (data.status === 'success' && data.data) {
                // Render Markdown (Simple Converter)
                renderAIResponse(data.data);

                // If it's the suggestions, we might want to save it to notes? 
                // For now just display.
            } else {
                console.warn("AI Error:", data);
                document.getElementById('ai-result-container').innerHTML = `
                <div class="p-4 bg-red-50 text-red-600 rounded-xl border border-red-200">
                    <i class="fa-solid fa-triangle-exclamation mr-2"></i>
                    <strong>AI Error:</strong> ${data.message || "Unknown error from backend."}
                    <br><span class="text-xs mt-1 block opacity-75">Did you update the Google Apps Script? (v3)</span>
                </div>
            `;
            }
        })
        .catch(err => {
            console.error("Network Error:", err);
            document.getElementById('ai-loading').classList.add('hidden');
            document.getElementById('ai-result-container').classList.remove('hidden');
            document.getElementById('ai-result-container').innerHTML = `
            <div class="p-4 bg-red-50 text-red-600 rounded-xl border border-red-200">
                <i class="fa-solid fa-wifi mr-2"></i>
                <strong>Connection Failed:</strong> Could not reach AI service.
            </div>
        `;
        });
}

function renderAIResponse(markdownText) {
    // Simple/Safe Markdown-to-HTML parser for basic formatting
    let html = markdownText
        // Headers
        .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold text-slate-800 mt-4 mb-2">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold text-violet-700 mt-5 mb-3">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold text-slate-800 mb-4">$1</h1>')
        // Bold
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        // Lists
        .replace(/^\s*-\s+(.*)/gim, '<li class="ml-4 list-disc marker:text-violet-500">$1</li>')
        // Newlines to breaks
        .replace(/\n/gim, '<br>');

    document.getElementById('ai-result-container').innerHTML = html;
}

// --------------------------------------------------------
// RESOURCES (SHARED DRIVE) LOGIC
// --------------------------------------------------------

function openResourcesModal() {
    document.getElementById('resources-modal').classList.remove('hidden');
    // Load saved folder ID if exists
    const savedId = localStorage.getItem('drive_folder_id');
    if (savedId) {
        document.getElementById('drive-folder-id').value = savedId;
        // Optional: Auto-fetch? Maybe not, prevents spamming if ID is wrong
    }
}

function closeResourcesModal() {
    document.getElementById('resources-modal').classList.add('hidden');
}

function fetchResources() {
    const folderId = document.getElementById('drive-folder-id').value.trim();
    if (!folderId) {
        alert("Please enter a Google Drive Folder ID.");
        return;
    }

    // Save for next time
    localStorage.setItem('drive_folder_id', folderId);

    // UI Loading
    document.getElementById('resources-list').innerHTML = "";
    document.getElementById('resources-loading').classList.remove('hidden');
    document.getElementById('resources-count').textContent = "Searching...";

    fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS fix
        body: JSON.stringify({ action: 'get_files', folderId: folderId })
    })
        .then(res => res.json())
        .then(data => {
            document.getElementById('resources-loading').classList.add('hidden');

            if (data.status === 'success' && data.files) {
                renderResources(data.files);
            } else {
                document.getElementById('resources-list').innerHTML = `
                <div class="text-center py-6 text-red-500">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                    <p>Error: ${data.message || "Could not fetch files"}</p>
                </div>
            `;
            }
        })
        .catch(err => {
            console.error(err);
            document.getElementById('resources-loading').classList.add('hidden');
            alert("Network Error: " + err.message);
        });
}

function renderResources(files) {
    const list = document.getElementById('resources-list');
    list.innerHTML = "";

    if (files.length === 0) {
        list.innerHTML = `
            <div class="text-center py-10 text-slate-400">
                <p>No files found in this folder.</p>
            </div>
        `;
        document.getElementById('resources-count').textContent = "0 items";
        return;
    }

    document.getElementById('resources-count').textContent = `${files.length} items found`;

    files.forEach(file => {
        // Icon selection based on mimeType
        let iconClass = "fa-file text-slate-400";
        if (file.mimeType.includes("pdf")) iconClass = "fa-file-pdf text-red-500";
        else if (file.mimeType.includes("sheet") || file.mimeType.includes("csv")) iconClass = "fa-file-excel text-green-600";
        else if (file.mimeType.includes("doc")) iconClass = "fa-file-word text-blue-600";
        else if (file.mimeType.includes("image")) iconClass = "fa-file-image text-purple-500";

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:shadow-md transition-shadow group";
        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                    <i class="fa-solid ${iconClass} text-xl group-hover:scale-110 transition-transform"></i>
                </div>
                <div class="truncate">
                    <h4 class="font-bold text-slate-700 text-sm truncate" title="${file.name}">${file.name}</h4>
                    <p class="text-[10px] text-slate-400">
                        ${(file.size / 1024).toFixed(0)} KB • 
                        Updated: ${new Date(file.lastUpdated).toLocaleDateString()}
                    </p>
                </div>
            </div>
            <a href="${file.url}" target="_blank" 
                class="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors">
                Open <i class="fa-solid fa-external-link-alt ml-1"></i>
            </a>
        `;
        list.appendChild(div);
    });
}

// --- Section/Ward Customization Modal Logic ---

var sectionModalState = { color: 'slate', icon: 'hospital' };

function addNewWard() {
    // Override standard prompt with Modal
    const modal = document.getElementById('section-modal');
    modal.classList.remove('hidden');
    document.getElementById('new-section-name').value = '';

    // Reset selection state
    sectionModalState = { color: 'slate', icon: 'hospital' };
    selectSectionColor('slate');
    selectSectionIcon('hospital');
}

function closeSectionModal() {
    document.getElementById('section-modal').classList.add('hidden');
}

function selectSectionColor(color) {
    sectionModalState.color = color;
    document.querySelectorAll('.section-color-btn').forEach(btn => {
        if (btn.dataset.color === color) {
            btn.classList.add('ring-2', 'ring-slate-400');
        } else {
            btn.classList.remove('ring-2', 'ring-slate-400');
        }
    });
}

function selectSectionIcon(icon) {
    sectionModalState.icon = icon;
    document.querySelectorAll('.section-icon-btn').forEach(btn => {
        if (btn.dataset.icon === icon) {
            btn.classList.add('ring-2', 'ring-slate-400', 'bg-slate-200');
        } else {
            btn.classList.remove('ring-2', 'ring-slate-400', 'bg-slate-200');
        }
    });
}

function confirmAddSection() {
    const name = document.getElementById('new-section-name').value;
    if (!name || name.trim() === "") return;

    if (appData.sections.find(s => s.name === name)) {
        alert("Section already exists!");
        return;
    }

    const newSection = {
        id: Date.now().toString(),
        name: name,
        color: sectionModalState.color,
        icon: sectionModalState.icon,
        isPersistent: true
    };

    appData.sections.push(newSection);
    appData.wards[name] = []; // Init empty

    saveMetadata(); // Sync to server
    renderWardsSidebar();
    selectWard(name);

    closeSectionModal();
}

function quickAddStandardSections() {
    if (!confirm("Quick Add 5 Standard Sections?\\n(Medical, Surgical, Hematology, ICU, Treatment Room)")) return;

    const standards = [
        { name: 'Medical', color: 'blue', icon: 'user-doctor' },
        { name: 'Surgical', color: 'red', icon: 'syringe' },
        { name: 'Hematology', color: 'purple', icon: 'flask' },
        { name: 'ICU', color: 'orange', icon: 'heart-pulse' },
        { name: 'Treatment Room', color: 'green', icon: 'bed-pulse' }
    ];

    let addedCount = 0;
    standards.forEach(s => {
        if (!appData.sections.find(existing => existing.name === s.name)) {
            appData.sections.push({
                id: Date.now() + Math.random().toString(), // uniqueish
                name: s.name,
                color: s.color,
                icon: s.icon,
                isPersistent: true
            });
            appData.wards[s.name] = [];
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveMetadata();
        renderWardsSidebar();
        selectWard('Medical'); // Jump to first one
        alert(`Added ${addedCount} sections.`);
    } else {
        alert("All standard sections already exist.");
    }
}

// --- Plan System Logic ---

function openPlanModal(patient) {
    appData.currentPatient = patient; // Ensure context
    const modal = document.getElementById('plan-modal');
    modal.classList.remove('hidden');
    resetPlanView();
}

function closePlanModal() {
    document.getElementById('plan-modal').classList.add('hidden');
}

function resetPlanView() {
    document.getElementById('plan-options-grid').classList.remove('hidden');

    ['plan-sub-medication', 'plan-sub-equipment', 'plan-sub-note'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}

function showPlanDetail(type) {
    document.getElementById('plan-options-grid').classList.add('hidden');

    if (type === 'medication') {
        document.getElementById('plan-sub-medication').classList.remove('hidden');
        document.getElementById('med-input-area').classList.add('hidden'); // Reset input
    } else if (type === 'equipment') {
        document.getElementById('plan-sub-equipment').classList.remove('hidden');
    } else if (type.startsWith('consult') || type === 'note') {
        const noteView = document.getElementById('plan-sub-note');
        noteView.classList.remove('hidden');

        const titles = {
            'consult_physio': 'Physiotherapy Consult',
            'consult_psych': 'Psychosocial Consult',
            'consult_nutrition': 'Nutrition Consult',
            'note': 'Add Clinical Note'
        };
        document.getElementById('plan-note-title').innerText = titles[type] || 'Add Note';
        document.getElementById('plan-note-text').value = '';
        document.getElementById('plan-note-text').dataset.type = type;
    }
}

// Medication Flow
var currentMedAction = '';
function selectMedAction(action) {
    currentMedAction = action;
    document.getElementById('med-input-area').classList.remove('hidden');
    document.getElementById('plan-med-details').focus();
}

function savePlanItem(category) {
    if (!appData.currentPatient.plan || !Array.isArray(appData.currentPatient.plan)) {
        appData.currentPatient.plan = [];
    }

    let newItem = null;

    if (category === 'medication') {
        const details = document.getElementById('plan-med-details').value;
        if (!details) return;

        newItem = {
            id: Date.now(),
            type: 'medication',
            action: currentMedAction,
            details: details,
            date: new Date().toISOString()
        };
    } else if (category === 'note') {
        const text = document.getElementById('plan-note-text').value;
        const type = document.getElementById('plan-note-text').dataset.type;
        if (!text) return;

        newItem = {
            id: Date.now(),
            type: type === 'note' ? 'note' : 'consult',
            subType: type, // e.g. consult_physio
            details: text,
            date: new Date().toISOString()
        };
    }

    if (newItem) {
        appData.currentPatient.plan.push(newItem);
        savePlanChanges();
        closePlanModal();

        // Refresh views
        if (appData.currentWard) renderPatientsGrid(appData.wards[appData.currentWard]);
    }
}

function saveQuickPlan(type, value) {
    // Ensure initialized
    if (!appData.currentPatient.plan || !Array.isArray(appData.currentPatient.plan)) {
        appData.currentPatient.plan = [];
    }

    const newItem = {
        id: Date.now(),
        type: type, // 'equipment'
        details: value,
        date: new Date().toISOString()
    };

    appData.currentPatient.plan.push(newItem);
    savePlanChanges();
    // closePlanModal(); // Keep open for multi-select

    if (appData.currentWard) renderPatientsGrid(appData.wards[appData.currentWard]);
}

function savePlanChanges() {
    const p = appData.currentPatient;
    const updates = {};
    updates[p.id] = { plan: p.plan };

    triggerSave(); // Local timer save
    if (GasApiAvailable()) syncBatchUpdate(updates);
}

function quickAddStandardSections() {
    const standards = [
        { name: 'Medical', color: 'blue', icon: 'stethoscope' },
        { name: 'Surgical', color: 'green', icon: 'bandage' },
        { name: 'Hematology', color: 'purple', icon: 'flask' },
        { name: 'ICU', color: 'orange', icon: 'heart-pulse' },
        { name: 'Treatment Room', color: 'slate', icon: 'bed-pulse' }
    ];

    // OPTION 2: Nuclear approach to force repair
    // Remove existing "standard" definitions to ensure clean slate
    const standardNames = standards.map(s => s.name);
    appData.sections = appData.sections.filter(s => !standardNames.includes(s.name));

    // Re-add all standards as fresh persistent sections
    standards.forEach(s => {
        appData.sections.push({
            name: s.name,
            color: s.color,
            icon: s.icon,
            isPersistent: true
        });
        if (!appData.wards[s.name]) appData.wards[s.name] = [];
    });

    saveMetadata();
    renderWardsSidebar();
    alert("Standard sections forced reset and added!");
}
