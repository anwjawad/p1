
// --------------------------------------------------------
// CONFIGURATION
// --------------------------------------------------------
// Use var to prevent "already declared" errors if script is double-loaded
// TODO: Update this URL with your deployed Web App URL
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

    currentPatient: null,
    historyIndex: { ids: new Set(), codes: new Set() },
    hvcList: []
};

// Pre-load history existence index
function loadHistoryIndex() {
    console.log("Loading History Index...");
    fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_history_index' })
    })
        .then(r => r.json())
        .then(json => {
            if (json.status === 'success') {
                appData.historyIndex.ids = new Set(json.ids);
                appData.historyIndex.codes = new Set(json.codes);
                console.log("History Index Loaded:", appData.historyIndex);
                // Re-render grid if data is already loaded to show badges
                if (appData.patients.length > 0) renderPatientsGrid(appData.patients);
            }
        })
        .catch(e => console.error("History Index Load Failed", e));
}

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
            // Find first ward with patients
            const populatedWard = wardKeys.find(key => appData.wards[key] && appData.wards[key].length > 0);
            const target = populatedWard || wardKeys[0];
            if (target) selectWard(target);
        }

        // Fetch HVC Status in parallel
        fetchHVCPatients();

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
            // Ensure we exit analytics view if open
            if (typeof closeAnalyticsView === 'function') closeAnalyticsView();
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

    // Clear old history cache & Trigger Check
    currentPatientHistory = [];
    if (typeof checkAndSetupSmartCopy === 'function') checkAndSetupSmartCopy(patient);

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
        const fullRowStr = line.toLowerCase();
        if (fullRowStr.includes('discontinued') || fullRowStr.includes('canceled') || fullRowStr.includes('held')) return;

        // Col 3 check for 'dc'
        if (cols[3] && cols[3].trim().toLowerCase() === 'dc') return;

        // 2. Identify Columns
        let nameIndex = -1;
        let detailIndex = -1;

        // New Logic: Iterate through columns to find the first VALID Name + Detail pair
        // We look for a column that looks like "Details" (Freq or Route)
        // AND verify the column before it is not empty (The Name)
        for (let i = 0; i < cols.length; i++) {
            if (freqRegex.test(cols[i]) || routeRegex.test(cols[i])) {
                // Potential Detail Column found at 'i'
                // Check if we have a valid Name candidate at 'i-1'
                if (i > 0 && cols[i - 1].trim()) {
                    detailIndex = i;
                    nameIndex = i - 1;
                    break; // Found the pair, stop searching
                }
            }
        }

        if (nameIndex < 0 || !cols[nameIndex]) return;

        const name = cols[nameIndex].trim();
        const details = cols[detailIndex] ? cols[detailIndex].trim() : '';

        // 3. Deduplicate
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
                    if (num < min) { statusClass = "text-blue-600 border-blue-400 bg-blue-50 font-bold"; statusIcon = "â†“"; }
                    else if (num > max) { statusClass = "text-red-600 border-red-400 bg-red-50 font-bold"; statusIcon = "â†‘"; }
                    else { statusClass = "text-emerald-600 border-emerald-400 bg-emerald-50"; statusIcon = "âœ“"; }
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

        // 3. "Calc Corrected Ca" Button
        const calcBtn = document.createElement('button');
        calcBtn.className = "flex flex-col items-center justify-center p-2 rounded-lg border border-slate-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-300 transition-all h-20 shadow-sm";
        calcBtn.innerHTML = `
            <i class="fa-solid fa-calculator text-lg mb-1"></i>
            <span class="text-[9px] font-bold uppercase text-center leading-tight">Corrected<br>Calcium</span>
        `;
        calcBtn.onclick = openCalciumCalculator;
        container.appendChild(calcBtn);

        // 4. "Add Lab" Button
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

        // --- Render Image Section ---
        // Find or Create Image Container below grid
        let imgContainer = document.getElementById('modal-lab-images');
        if (!imgContainer) {
            imgContainer = document.createElement('div');
            imgContainer.id = 'modal-lab-images';
            imgContainer.className = "mt-6 pt-6 border-t border-slate-100";
            // Insert after labs grid
            container.parentNode.appendChild(imgContainer);
        }
        renderLabImages();

    } catch (err) {
        console.error("Critical renderModalLabs error:", err);
        alert("UI Error: " + err.message);
    }
}

// --- Corrected Calcium Calculator ---

function openCalciumCalculator() {
    // 1. Get current values if available
    const labs = appData.currentPatient.labs || {};
    const currentCa = labs['Ca'] ? labs['Ca'].value : '';
    const currentAlb = labs['Alb'] ? labs['Alb'].value : '';

    // 2. Create Modal Elements dynamically
    let calcModal = document.getElementById('calc-modal');
    if (!calcModal) {
        calcModal = document.createElement('div');
        calcModal.id = 'calc-modal';
        calcModal.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-entry';
        calcModal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative border border-slate-200 transform transition-all scale-100">
                <button onclick="closeCalciumCalculator()" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors">
                    <i class="fa-solid fa-times text-xl"></i>
                </button>
                
                <h3 class="text-xl font-bold text-slate-800 mb-1">Corrected Calcium</h3>
                <p class="text-xs text-slate-500 mb-4">Formula: Serum Ca + 0.8 Ã— (4 - Serum Alb)</p>

                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Serum Calcium (mg/dL)</label>
                        <input type="text" id="calc-ca" inputmode="decimal"
                            class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-medical-500 outline-none text-lg font-bold text-slate-700 placeholder-slate-300"
                            placeholder="e.g. 8.0">
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Serum Albumin (g/dL)</label>
                        <input type="text" id="calc-alb" inputmode="decimal"
                            class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-medical-500 outline-none text-lg font-bold text-slate-700 placeholder-slate-300"
                            placeholder="e.g. 3.5">
                    </div>

                    <div class="p-5 bg-indigo-600 rounded-xl border border-indigo-700 text-center shadow-inner">
                        <span class="block text-xs text-indigo-200 font-bold uppercase tracking-wider mb-1">Calculated Result</span>
                        <div id="calc-result" class="text-4xl font-black text-white tracking-tight my-1">--</div>
                        <span class="text-xs text-indigo-200">mg/dL</span>
                    </div>

                    <button onclick="addCorrectedCalciumToLabs()" id="btn-add-calc" disabled
                        class="w-full py-3 bg-slate-800 text-white rounded-xl font-bold shadow-lg hover:shadow-xl hover:bg-slate-700 transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                        <i class="fa-solid fa-plus-circle mr-2"></i> Add to Labs
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(calcModal);
    } else {
        calcModal.classList.remove('hidden');
    }

    // 3. Populate
    const inpCa = document.getElementById('calc-ca');
    const inpAlb = document.getElementById('calc-alb');

    inpCa.value = currentCa;
    inpAlb.value = currentAlb;

    // Focus first empty input
    setTimeout(() => {
        if (!inpCa.value) inpCa.focus();
        else if (!inpAlb.value) inpAlb.focus();
    }, 100);

    // 4. Attach Listeners
    const update = () => {
        // Robust Parse: Handle commas as decimals
        const safeParse = (val) => {
            if (!val) return NaN;
            return parseFloat(val.toString().replace(',', '.'));
        };

        const ca = safeParse(inpCa.value);
        const alb = safeParse(inpAlb.value);
        const btn = document.getElementById('btn-add-calc');
        const resDiv = document.getElementById('calc-result');

        if (!isNaN(ca) && !isNaN(alb)) {
            // Formula: Ca + 0.8 * (4 - Alb)
            const corrected = ca + 0.8 * (4 - alb);
            resDiv.innerText = corrected.toFixed(2);
            btn.disabled = false;
            // Highlight result
            resDiv.classList.remove('opacity-50');
        } else {
            resDiv.innerText = "--";
            btn.disabled = true;
            resDiv.classList.add('opacity-50');
        }
    };

    // Events: use input and keyup for robustness
    inpCa.oninput = update;
    inpCa.onkeyup = update;
    inpAlb.oninput = update;
    inpAlb.onkeyup = update;

    // Enter key support
    const handleEnter = (e) => {
        if (e.key === 'Enter') {
            update(); // Ensure latest state
            const btn = document.getElementById('btn-add-calc');
            if (!btn.disabled) addCorrectedCalciumToLabs();
        }
    };
    inpCa.onkeydown = handleEnter;
    inpAlb.onkeydown = handleEnter;

    // Initial Run
    update();
}

function closeCalciumCalculator() {
    const m = document.getElementById('calc-modal');
    if (m) m.classList.add('hidden');
}

function addCorrectedCalciumToLabs() {
    const resDiv = document.getElementById('calc-result');
    const val = resDiv.innerText;

    if (val === '--' || !val) return;

    if (!appData.currentPatient.labs) appData.currentPatient.labs = {};

    appData.currentPatient.labs['Cor. Calcium'] = { value: val, unit: 'mg/dL' };

    triggerSave();
    renderModalLabs(appData.currentPatient.labs);
    closeCalciumCalculator();
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

// Alias for manual calls
const savePatientChanges = triggerSave;


// ----- IMPORT LOGIC -----

var csvData = [];
var csvHeaders = [];

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
    if (!confirm("âš ï¸ Are you sure you want to START A NEW DAY?\n\nThis will:\n1. Archive all current data to History Log.\n2. Reset Daily Symptoms & Labs for all patients.\n3. Keep Profiles & Meds intact.\n\nThis action cannot be undone from the app.")) {
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
            alert(`âœ… New Day Started Successfully!\n${json.archived_count} records archived.`);
            closeSettingsModal();
            location.reload(); // Reload to fetch clear data
        } else {
            throw new Error(json.error || "Unknown Error");
        }

    } catch (e) {
        alert("âŒ Error Starting New Day: " + e.message);
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
            // Parse Meds logic refactored to handle Objects vs Strings
            let regularMeds = [];
            let prnMeds = [];
            let rawCounts = { reg: 0, prn: 0 };

            try {
                let medSource = p.medications;

                // If string that looks like JSON, parse it
                if (typeof medSource === 'string' && medSource.trim().startsWith('{')) {
                    try { medSource = JSON.parse(medSource); } catch (e) { }
                }

                // If it is now an object (either originally or after parse)
                if (medSource && typeof medSource === 'object') {
                    if (medSource.regular) {
                        regularMeds = String(medSource.regular).split(/\n/).map(m => m.trim()).filter(m => m);
                    }
                    if (medSource.prn) {
                        prnMeds = String(medSource.prn).split(/\n/).map(m => m.trim()).filter(m => m);
                    }
                }
                // Fallback: simple string (legacy)
                else if (typeof medSource === 'string' && medSource.trim().length > 0) {
                    regularMeds = medSource.split(/\n/).map(m => m.trim()).filter(m => m);
                }

            } catch (e) {
                console.warn("Error parsing meds for print", p.name, e);
                regularMeds = ["Error reading medications"];
            }

            const formatList = (list) => {
                if (!list || list.length === 0) return '<span class="empty-note">- None -</span>';
                return `<ul>${list.map(m => `<li>${String(m || '').trim()}</li>`).join('')}</ul>`;
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
                        ${(file.size / 1024).toFixed(0)} KB â€¢ 
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

async function generatePatientSummary(patient) {
    if (!GasApiAvailable()) {
        alert("AI Summary requires backend connection.");
        return null;
    }

    try {
        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'generate_summary', patient: patient })
        });

        const json = await res.json();
        if (json.status === 'success') {
            return json.data;
        } else {
            console.error("AI Error:", json);
            alert("AI Error: " + (json.message || "Unknown error"));
            return null;
        }
    } catch (e) {
        console.error("Summary request failed", e);
        alert("Failed to generate summary: " + e.message);
        return null;
    }
}



function generateManualSummary(p) {
    if (!p) return "";

    let summary = `PATIENT SUMMARY\n----------------\n`;
    summary += `Name: ${p.name || 'N/A'} (${p.age || '?'}y) - Room: ${p.room || '?'}\n`;
    summary += `Diagnosis: ${p.diagnosis || 'Unspecified'}\n`;

    // Symptoms
    if (p.symptoms) {
        let symsObj = p.symptoms;
        if (typeof symsObj === 'string') {
            try { symsObj = JSON.parse(symsObj); } catch (e) { symsObj = {}; }
        }
        const activeSyms = Object.entries(symsObj)
            .filter(([k, v]) => v && v.active === true)
            .map(([k, v]) => `${k}${v.note ? ' (' + v.note + ')' : ''}`)
            .join(', ');
        if (activeSyms) summary += `Active Symptoms: ${activeSyms}\n`;
    }

    // Meds
    let medList = '';
    if (p.medications) {
        let meds = p.medications;
        if (typeof meds === 'string' && meds.trim().startsWith('{')) {
            try { meds = JSON.parse(meds); } catch (e) { }
        }

        if (typeof meds === 'object') {
            const reg = meds.regular ? `Regular: ${meds.regular.replace(/\n/g, ', ')}` : '';
            const prn = meds.prn ? `PRN: ${meds.prn.replace(/\n/g, ', ')}` : '';
            medList = [reg, prn].filter(Boolean).join(' | ');
        } else {
            medList = String(meds).replace(/\n/g, ', ');
        }
    }
    if (medList) summary += `Meds: ${medList}\n`;

    // Labs (Critical Fix: Extract .value)
    if (p.labs) {
        let labsObj = p.labs;
        if (typeof labsObj === 'string') {
            try { labsObj = JSON.parse(labsObj); } catch (e) { labsObj = {}; }
        }
        const labList = Object.entries(labsObj)
            .filter(([k, v]) => v && v.value) // Only show if has value
            .map(([k, v]) => `${k}:${v.value}`)
            .join(', ');
        if (labList) summary += `Labs: ${labList}\n`;
    }

    return summary;
}

function handleManualSummary() {
    if (!confirm("Insert Manual Summary? This will prepend to Clinical Notes.")) return;

    const notesField = document.getElementById('inp-notes');
    const oldNotes = notesField.value;
    const summary = generateManualSummary(appData.currentPatient);

    if (summary) {
        const timestamp = new Date().toLocaleDateString('en-GB');
        notesField.value = `*** Manual Summary (${timestamp}) ***\n${summary}\n\n${oldNotes}`;
        appData.currentPatient.notes = notesField.value;
        savePatientChanges(appData.currentPatient.id);
    }
}

async function handleStandaloneSummary() {
    if (!confirm("Generate AI Summary? This will overwrite/prepend to Clinical Notes.")) return;

    // Show loading
    const notesField = document.getElementById('inp-notes');
    const oldNotes = notesField.value;
    notesField.value = "Generating AI Summary...";
    notesField.disabled = true;

    const summary = await generatePatientSummary(appData.currentPatient);

    notesField.disabled = false;
    if (summary) {
        const timestamp = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
        // Prepend summary
        notesField.value = `*** AI Summary (${timestamp}) ***\n${summary}\n\n${oldNotes}`;
        // Trigger save
        appData.currentPatient.notes = notesField.value;
        savePatientChanges(appData.currentPatient.id);
    } else {
        notesField.value = oldNotes; // Revert
    }
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

        // Auto-Suggest Summary for Consults
        if (type.startsWith('consult')) {
            setTimeout(async () => {
                if (confirm("Generate AI Patient Summary for this consult?")) {
                    const textarea = document.getElementById('plan-note-text');
                    textarea.value = "Generating summary...";
                    textarea.disabled = true;

                    const summary = await generatePatientSummary(appData.currentPatient);

                    textarea.disabled = false;
                    if (summary) {
                        textarea.value = summary + "\n\n---\n" + (titles[type] || 'Consult') + ": ";
                        textarea.focus();
                    } else {
                        textarea.value = "";
                    }
                }
            }, 100);
        }
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


// --------------------------------------------------------
// ANALYTICS DASHBOARD LOGIC
// --------------------------------------------------------

let charts = {
    census: null,
    symptoms: null,
    diagnosis: null
};

function openAnalyticsView() {
    document.querySelector('main').classList.add('hidden');
    document.getElementById('analytics-view').classList.remove('hidden');
    // Hide Sidebar on mobile automatically
    document.getElementById('sidebar').classList.add('-translate-x-full');

    generateUnitAnalytics();
}

function closeAnalyticsView() {
    document.getElementById('analytics-view').classList.add('hidden');
    document.querySelector('main').classList.remove('hidden');
}

function refreshAnalytics() {
    generateUnitAnalytics();
}

async function generateUnitAnalytics() {
    const patients = appData.patients || [];

    // 1. Diagnosis Distribution (Still from Active Patients)
    const diagnoses = {};
    patients.forEach(p => {
        let d = p.diagnosis ? p.diagnosis.split(/[\n,]/)[0].trim() : 'Unspecified';
        if (!d) d = 'Unspecified';
        diagnoses[d] = (diagnoses[d] || 0) + 1;
    });

    const sortedDiag = Object.entries(diagnoses)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7);

    // 2. Fetch Historical Trends from Backend (History_Log)
    if (!GasApiAvailable()) {
        alert("Analytics requires backend connection.");
        return;
    }

    // Show Loading State on Charts
    // (Optional: Add loading overlay)

    try {
        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'get_analytics' })
        });

        // Handling GAS CORS quirk:
        // Regular POST to /exec often issues 302 redirect. 'follow' handles it, but requires 'text/plain' to avoid preflight options failure if not handled.
        // My GAS Code.gs HAS doOptions, so application/json MIGHT work, but text/plain is safer for GAS.

        const json = await res.json();

        if (json.status === 'success') {
            renderCharts(sortedDiag, json.dates, json.symptoms, json.census);
        } else {
            console.error("Analytics Error", json);
            alert("Failed to load analytics: " + (json.error || "Unknown error"));
        }

    } catch (e) {
        console.error("Fetch Analytics Failed", e);
        // Fallback or Alert?
        // alert("Could not fetch history. Showing active data only.");
        // renderCharts(sortedDiag, [], {}, 0);
    }
}

function renderCharts(diagnoses, dates, symptomData, censusData) {
    // Dates are formatted YYYY-MM-DD
    const labels = dates.map(d => d.slice(5)); // MM-DD

    renderCensusChart(dates, censusData);
    renderSymptomChart(labels, symptomData);
    renderDiagnosisChart(diagnoses);
}

function renderCensusChart(labels, data) {
    const ctx = document.getElementById('chart-census').getContext('2d');
    if (charts.census) charts.census.destroy();

    charts.census = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Patients',
                data: data,
                backgroundColor: '#3b82f6',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }, // Hide legend if single dataset
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

function renderSymptomChart(labels, data) {
    const ctx = document.getElementById('chart-symptoms').getContext('2d');
    if (charts.symptoms) charts.symptoms.destroy();

    // Transform data object to datasets
    const datasets = [];
    const colors = ['#ef4444', '#f97316', '#3b82f6', '#10b981', '#8b5cf6'];
    let cIdx = 0;

    Object.keys(data).forEach(k => {
        // filter out empty symptoms to reduce clutter?
        // if (data[k].some(v => v > 0)) {
        datasets.push({
            label: k,
            data: data[k],
            borderColor: colors[cIdx % colors.length],
            backgroundColor: colors[cIdx % colors.length],
            tension: 0.3
        });
        cIdx++;
        // }
    });

    charts.symptoms = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

function renderDiagnosisChart(diagnoses) {
    const ctx = document.getElementById('chart-diagnosis').getContext('2d');
    if (charts.diagnosis) charts.diagnosis.destroy();

    charts.diagnosis = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: diagnoses.map(d => d[0]),
            datasets: [{
                data: diagnoses.map(d => d[1]),
                backgroundColor: [
                    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });
}

// OVERRIDE: Update showPlanDetail to use Manual Summary for Consults
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

        // Auto-Suggest Summary for Consults (Manual Summary)
        if (type.startsWith('consult')) {
            setTimeout(() => {
                if (confirm('Insert Patient Summary details for this consult?')) {
                    const textarea = document.getElementById('plan-note-text');
                    const summary = generateManualSummary(appData.currentPatient);

                    if (summary) {
                        textarea.value = summary + '\n\n---\n' + (titles[type] || 'Consult') + ': ';
                        textarea.focus();
                    }
                }
            }, 100);
        }
    }
}

// --- Plan Item Deletion ---
function deletePlanItem(event, patientId, index) {
    if (event) {
        event.stopPropagation();
        event.preventDefault(); // Extra safety
    }

    // Safety check for appData
    if (!window.appData || !window.appData.patients) {
        console.error("AppData not initialized");
        return;
    }

    const patient = appData.patients.find(p => p.id === patientId);
    if (!patient || !patient.plan) return;

    if (!confirm("Delete this plan item?")) return;

    // Remove item
    patient.plan.splice(index, 1);

    // Save and Re-render
    if (typeof triggerSave === 'function') triggerSave();
    if (typeof renderPatientsGrid === 'function') renderPatientsGrid(appData.patients);
}

// --- History / Time Machine Logic ---
let isHistoryMode = false;
let realAppData = null; // Backup for live data

function openHistoryView() {
    const modal = document.getElementById('history-modal');
    const list = document.getElementById('history-list');
    const loading = document.getElementById('history-loading');

    modal.classList.remove('hidden');
    list.innerHTML = '';
    loading.classList.remove('hidden');

    // Fetch Dates
    fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_history_dates' })
    })
        .then(r => r.json())
        .then(json => {
            loading.classList.add('hidden');
            if (json.status === 'success' && json.dates.length > 0) {
                json.dates.reverse().forEach(date => {
                    const btn = document.createElement('button');
                    btn.className = "w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-100 font-bold text-slate-700 flex justify-between items-center group transition-colors";
                    btn.innerHTML = `
                    <span>${date}</span>
                    <i class="fa-solid fa-chevron-right text-slate-300 group-hover:text-slate-500"></i>
                `;
                    btn.onclick = () => loadHistoryDate(date);
                    list.appendChild(btn);
                });
            } else {
                list.innerHTML = '<p class="text-center text-slate-400 text-sm py-4">No archives found.</p>';
            }
        })
        .catch(err => {
            console.error(err);
            loading.classList.add('hidden');
            list.innerHTML = '<p class="text-center text-red-400 text-sm py-4">Failed to load history.</p>';
        });
}

function closeHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
}

function loadHistoryDate(date) {
    if (!confirm(`Enter Read-Only Archive Mode for ${date}?`)) return;

    // Backup live data if not already in history mode
    if (!isHistoryMode) {
        realAppData = JSON.parse(JSON.stringify(appData));
    }

    closeHistoryModal();

    // Show loading overlay (re-use existing one if possible or just rely on speed)

    fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_history_data', date: date })
    })
        .then(r => r.json())
        .then(json => {
            if (json.status === 'success') {
                enterHistoryMode(json.patients, date);
            } else {
                alert("Error loading archive: " + json.message);
            }
        })
        .catch(e => alert("Network Error: " + e.message));
}

function enterHistoryMode(archivedPatients, date) {
    isHistoryMode = true;

    // Switch Data
    appData.patients = archivedPatients;
    // ensure Set exists
    appData.selectedPatientIds = new Set();

    // UI Update
    document.getElementById('archive-banner').classList.remove('hidden');
    document.getElementById('archive-date-display').textContent = date;
    document.body.style.paddingTop = "3.5rem"; // Make room for banner

    // Render
    renderPatientsGrid(appData.patients);

    // Disable Editing UI (Roughly)
    document.getElementById('floating-action-bar').classList.add('hidden'); // Hide bulk actions
}

function exitHistoryMode() {
    if (!isHistoryMode || !realAppData) return;

    // Restore
    appData = realAppData;
    // re-init Set because JSON.stringify destroyed it
    appData.selectedPatientIds = new Set();

    isHistoryMode = false;
    realAppData = null;

    // UI Reset
    document.getElementById('archive-banner').classList.add('hidden');
    document.body.style.paddingTop = "0";
    document.getElementById('floating-action-bar').classList.remove('hidden');

    // Render Live Data
    renderPatientsGrid(appData.patients);
}

// Override Save Check
const originalTriggerSave = window.triggerSave;
window.triggerSave = function () {
    if (isHistoryMode) {
        console.warn("Save blocked: History Mode Active");
        // Optional: toast notification "Read Only Mode"
        return;
    }
    if (originalTriggerSave) originalTriggerSave();
};


// --- Patient Specific History & Smart Copy ---

let currentPatientHistory = []; // Cache for the currently open patient

function openPatientHistory(patientId) {
    const patient = appData.patients.find(p => p.id === patientId);
    if (!patient) return;

    const modal = document.getElementById('patient-history-modal');
    const content = document.getElementById('patient-history-content');
    const loading = document.getElementById('patient-history-loading');

    modal.classList.remove('hidden');
    content.innerHTML = '';
    loading.classList.remove('hidden');

    fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_patient_history', id: patient.id, name: patient.name, code: patient.code })
    })
        .then(r => r.json())
        .then(json => {
            loading.classList.add('hidden');
            if (json.status === 'success' && json.history.length > 0) {
                currentPatientHistory = json.history; // Cache for smart copy
                renderPatientTimeline(json.history);
            } else {
                currentPatientHistory = [];
                content.innerHTML = `
                <div class="text-center py-10 text-slate-400">
                    <i class="fa-regular fa-folder-open text-4xl mb-2 opacity-50"></i>
                    <p>No prior history found.</p>
                </div>
            `;
            }
        })
        .catch(e => {
            console.error(e);
            loading.classList.add('hidden');
            content.textContent = "Error loading history.";
        });
}

function closePatientHistoryModal() {
    document.getElementById('patient-history-modal').classList.add('hidden');
}

// --- HISTORY TIMELINE RENDERER (Clean Card Style) ---
function renderPatientTimeline(history) {
    const content = document.getElementById('patient-history-content');
    content.innerHTML = '';

    if (!history || !Array.isArray(history)) {
        content.innerHTML = '<p class="text-center text-slate-400 py-10">No history available.</p>';
        return;
    }

    history.forEach((record, index) => {

        const date = new Date(record.Date).toLocaleDateString(undefined, {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });

        // 1. Diagnosis & Treatment
        let dxHtml = '';
        if (record.diagnosis) {
            dxHtml += `
             <div class="text-sm text-slate-700 leading-snug font-medium border-l-2 border-blue-500 pl-3 py-0.5 my-2">
                <span class="font-bold text-blue-600 text-[10px] uppercase bg-blue-50 px-1 rounded mr-1 align-middle">Dx</span> 
                ${record.diagnosis}
             </div>`;
        }

        if (record.treatment) {
            dxHtml += `
             <div class="text-sm text-slate-600 leading-snug font-medium border-l-2 border-emerald-500 pl-3 py-0.5 my-2">
                <span class="font-bold text-emerald-600 text-[10px] uppercase bg-emerald-50 px-1 rounded mr-1 align-middle">Rx</span> 
                ${record.treatment}
             </div>`;
        }

        // 2. Labs (New)
        let labsHtml = '';
        try {
            let lData = record.labs;
            if (typeof lData === 'string') lData = JSON.parse(lData);
            if (lData && typeof lData === 'object') {
                const labBadges = Object.entries(lData).map(([k, v]) => {
                    // Simple check (no global ranges access here easily, assume string val)
                    const val = v.value || v;
                    if (!val) return '';
                    return `<span class="px-1.5 py-0.5 rounded border text-[10px] bg-indigo-50 text-indigo-700 border-indigo-100 font-bold flex items-center">
                        ${k} ${val}
                     </span>`;
                }).join('');
                if (labBadges) labsHtml = `<div class="flex flex-wrap gap-1.5 mb-2">${labBadges}</div>`;
            }
        } catch (e) { /* ignore */ }

        // 3. Symptoms
        let symptomsHtml = '';
        try {
            let sData = record.symptoms;
            if (typeof sData === 'string') sData = JSON.parse(sData);

            if (sData && typeof sData === 'object') {
                const active = Object.entries(sData).filter(([k, v]) => v && v.active === true);
                if (active.length > 0) {
                    symptomsHtml = active.map(([k, v]) => {
                        let note = (v.note && v.note.trim()) ? `<span class="opacity-75 relative -top-[1px] ml-1 pl-1 border-l border-rose-300 text-[9px] italic">${v.note}</span>` : '';
                        return `<span class="px-2 py-1 rounded-md border text-xs bg-rose-50 text-rose-700 border-rose-100 font-bold inline-flex items-center text-left leading-none shadow-sm">
                            ${k}${note}
                        </span>`;
                    }).join('');

                    if (symptomsHtml) symptomsHtml = `<div class="flex flex-wrap gap-1.5 mt-2">${symptomsHtml}</div>`;
                }
            }
        } catch (e) { console.warn("History symptom parse error", e); }

        // 4. Plan / Equipment (New)
        let planHtml = '';
        try {
            let pData = record.plan;
            if (typeof pData === 'string') pData = JSON.parse(pData);
            if (Array.isArray(pData) && pData.length > 0) {
                planHtml = `<div class="mt-3 pt-2 border-t border-slate-50 grid grid-cols-2 gap-1">`;
                pData.forEach(item => {
                    let color = 'text-slate-600';
                    let icon = 'circle';
                    if (item.type === 'medication') { color = 'text-indigo-600'; icon = 'pills'; }
                    else if (item.type === 'equipment') { color = 'text-cyan-600'; icon = 'mask-ventilator'; }

                    planHtml += `<div class="flex items-center gap-1.5 text-[10px] ${color}">
                        <i class="fa-solid fa-${icon}"></i>
                        <span class="truncate font-medium">${item.details}</span>
                    </div>`;
                });
                planHtml += `</div>`;
            }
        } catch (e) { /* ignore */ }

        // 5. Notes
        let notesHtml = '';
        if (record.notes && record.notes.length > 0) {
            notesHtml = `
            <div class="mt-3 p-3 bg-yellow-50 rounded-lg text-yellow-800 text-xs border border-yellow-100 relative">
                <i class="fa-solid fa-sticky-note absolute top-3 right-3 opacity-20 text-yellow-600"></i>
                <span class="font-bold text-yellow-600 block mb-1">Notes:</span> 
                <span class="leading-relaxed whitespace-pre-wrap">${record.notes}</span>
            </div>`;
        }

        // --- RENDER ITEM ---
        const item = document.createElement('div');
        item.className = "pl-4 pb-8 border-l-2 border-slate-100 relative last:border-0 last:pb-0";

        item.innerHTML = `
            <!-- Dot -->
            <div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-slate-200 border-2 border-white ring-1 ring-slate-100"></div>
            
            <!-- Date Header -->
            <div class="mb-3 flex items-center gap-2">
                 <span class="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded-full border border-slate-200">
                    <i class="fa-regular fa-calendar mr-1"></i> ${date}
                 </span>
                 ${index === 0 ? '<span class="text-[10px] font-bold text-medical-600 bg-medical-50 px-1.5 rounded uppercase tracking-wider">Latest</span>' : ''}
            </div>

            <!-- Card Content -->
            <div class="bg-white rounded-xl p-4 shadow-sm border border-slate-200 hover:shadow-md transition-shadow relative overflow-hidden group">
                                
                ${labsHtml}

                ${dxHtml}
                
                ${symptomsHtml}
                
                ${planHtml}
                
                ${notesHtml}

                <!-- Empty State -->
                ${(!dxHtml && !symptomsHtml && !notesHtml && !labsHtml && !planHtml) ? '<p class="text-slate-400 italic text-xs">No significant clinical data recorded.</p>' : ''}
                
                <!-- Smart Copy Button Overlay (Visible on Hover) -->
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button onclick="injectSmartCopyButtons(${JSON.stringify(record).replace(/"/g, '&quot;')})" 
                             class="text-[10px] bg-slate-800 text-white px-2 py-1 rounded shadow hover:bg-slate-600 transition-colors" title="Enable Smart Copy for this record">
                         <i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Use
                     </button>
                </div>
            </div>
        `;
        content.appendChild(item);
    });
}

// Check for history availability (called when opening detail modal)
// Check for history availability (called when opening detail modal)
function checkAndSetupSmartCopy(patient) {
    // 1. OPTIMISTIC CHECK: Instant Badge
    // If we know they have history from our index, show badge immediately
    if (appData.historyIndex &&
        (appData.historyIndex.ids.has(String(patient.id)) ||
            (patient.code && appData.historyIndex.codes.has(String(patient.code))))) {
        console.log("Optimistic History Badge: Showing...");
        showHistoryAvailableBadge();
    }

    // 2. Fetch Data for Smart Copy / Timeline
    fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_patient_history', id: patient.id, name: patient.name, code: patient.code })
    })
        .then(r => r.json())
        .then(json => {
            if (json.status === 'success' && json.history.length > 0) {
                currentPatientHistory = json.history;

                // Ensure badge is shown (in case index was outdated)
                showHistoryAvailableBadge();

                try {
                    injectSmartCopyButtons(json.history[0]);
                } catch (e) { console.error("Smart Copy Injection Error", e); }
            }
        });
}

function showHistoryAvailableBadge() {
    console.log("Attempting to show History Badge...");
    // Find the name input container
    const nameInput = document.getElementById('modal-patient-name');
    if (!nameInput) {
        console.warn("History Badge: Name input not found.");
        return;
    }

    // Safety check: ensure we are targeting the right area
    const inputParent = nameInput.parentElement;
    if (!inputParent) return;

    // We need to find the specific layout container. 
    // In our logic below, we might have ALREADY moved the input into 'name-badge-row'.
    // So 'inputParent' might be 'name-badge-row' OR 'flex-1 mr-4'.

    let rowWrapper = null;
    let mainWrapper = null;

    if (inputParent.classList.contains('name-badge-row')) {
        rowWrapper = inputParent;
        mainWrapper = rowWrapper.parentElement;
    } else {
        mainWrapper = inputParent; // This is the 'flex-1 mr-4'
    }

    // Cleanup logic: If badge exists, do nothing (or re-bind?)
    if (rowWrapper && rowWrapper.querySelector('.history-badge')) {
        console.log("History Badge: Already exists.");
        return;
    }

    // Create Badge
    const badge = document.createElement('span');
    badge.className = "history-badge inline-flex items-center gap-1 ml-2 bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-200 cursor-pointer hover:bg-amber-200 transition-colors align-middle shadow-sm select-none";
    badge.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> History';
    badge.title = "View Patient History Timeline";
    badge.style.whiteSpace = "nowrap";

    badge.onclick = (e) => {
        e.stopPropagation();
        if (appData.currentPatient) {
            openPatientHistory(appData.currentPatient.id);
        } else {
            console.error("No current patient context");
        }
    };

    // DOM Manipulation
    if (!rowWrapper) {
        // We need to CREATE the row wrapper
        rowWrapper = document.createElement('div');
        rowWrapper.className = "name-badge-row flex items-center w-full";

        // Swap: Insert Wrapper before Input, then move Input inside Wrapper
        nameInput.parentNode.insertBefore(rowWrapper, nameInput);
        rowWrapper.appendChild(nameInput);

        // Fix input flex characteristics
        nameInput.classList.remove('w-full');
        nameInput.classList.add('flex-1');
        nameInput.style.minWidth = "0";
    }

    rowWrapper.appendChild(badge);
    console.log("History Badge: Added successfully.");
}


function injectSmartCopyButtons(latestRecord) {
    // Mapping: Record Key -> Input ID
    const mapping = {
        'diagnosis': 'inp-diagnosis',
        'notes': 'inp-notes',
        'treatment': 'inp-treatment'
    };

    // 1. Simple Fields
    Object.entries(mapping).forEach(([key, inputId]) => {
        const input = document.getElementById(inputId);
        if (!input) return;

        // Cleanup old button
        const wrapper = input.parentElement;
        if (wrapper.style.position !== 'relative') wrapper.style.position = 'relative';
        const oldBtn = wrapper.querySelector('.smart-copy-btn');
        if (oldBtn) oldBtn.remove();

        let val = latestRecord[key];
        if (!val || typeof val !== 'string' || val.trim() === '') return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = "smart-copy-btn absolute right-2 top-2 text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 transition-colors z-20 border border-indigo-200 flex items-center gap-1 opacity-70 hover:opacity-100";
        btn.innerHTML = `<i class="fa-solid fa-paste"></i> Copy Old`;
        btn.title = `Paste from history:\n${val}`;

        btn.onclick = () => {
            // Flash effect
            input.style.transition = 'all 0.2s';
            input.style.backgroundColor = '#e0e7ff';
            setTimeout(() => input.style.backgroundColor = '', 300);

            // Paste
            // If field has content, maybe append or replace? Replace is safer for "Correction".
            // Let's ask or just Replace. "Smart Copy" implies replacing usually in this context.
            if (input.value && !confirm(`Replace current text with historical data?\n\n"${val}"`)) return;

            input.value = val;
            input.dispatchEvent(new Event('input')); // Trigger Save
            triggerSave();
        };

        wrapper.appendChild(btn);
    });

    // 2. Medications (Complex)
    // We try to handle 'medications' if it exists
    if (latestRecord.medications) {
        let meds = latestRecord.medications;
        if (typeof meds === 'string') {
            try { meds = JSON.parse(meds); }
            catch (e) { meds = { regular: meds }; } // Fallback to raw string as regular
        }

        // Regular
        if (meds.regular) {
            addMedCopyBtn('inp-medications-regular', meds.regular);
        }
        // PRN
        if (meds.prn) {
            addMedCopyBtn('inp-medications-prn', meds.prn);
        }
    }
}

function addMedCopyBtn(inputId, text) {
    const input = document.getElementById(inputId);
    if (!input || !text) return;

    const wrapper = input.parentElement;
    if (wrapper.style.position !== 'relative') wrapper.style.position = 'relative';
    const oldBtn = wrapper.querySelector('.smart-copy-btn');
    if (oldBtn) oldBtn.remove();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = "smart-copy-btn absolute right-2 top-2 text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 transition-colors z-20 border border-indigo-200 flex items-center gap-1 opacity-70 hover:opacity-100";
    btn.innerHTML = `<i class="fa-solid fa-file-import"></i> Restore`;
    btn.title = `Restore meds from history`;

    btn.onclick = () => {
        if (input.value && !confirm("Replace current medications with historical list?")) return;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        triggerSave();
    };
    wrapper.appendChild(btn);
}

// Hook into showPatientDetail
const originalShowDetail = window.showPatientDetail;
window.showPatientDetail = function (patientId) {
    // alert("Debug: Opening Patient " + patientId); // Stage 1
    if (originalShowDetail) {
        originalShowDetail(patientId);
    }

    const patient = appData.patients.find(p => p.id === patientId);
    if (patient) {
        // Clear old history cache
        currentPatientHistory = [];
        // Trigger check
        checkAndSetupSmartCopy(patient);
    }
};

// --- DEBUG TOOL ---
function testHistoryConnection() {
    const testId = prompt("Enter Patient ID or Code to test:", "PAT108425");
    if (!testId) return;

    alert(`Testing Connection...\n1. Global Index\n2. Patient Specific (${testId})`);

    // Test 1: Global Index
    fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_history_index' })
    })
        .then(r => r.json())
        .then(idxJson => {
            let idxMsg = "INDEX CHECK:\n";
            if (idxJson.status === 'success') {
                idxMsg += `IDs Found: ${idxJson.ids.length}\nCodes Found: ${idxJson.codes.length}\n`;
                if (idxJson.ids.includes(testId) || idxJson.codes.includes(testId)) {
                    idxMsg += "âœ… THIS ID WAS FOUND IN INDEX (Badge should show!)\n";
                } else {
                    idxMsg += "âš ï¸ ID NOT IN INDEX (Badge will NOT show)\n";
                }
            } else {
                idxMsg += "âŒ Index Fetch Failed (Backend Error)\n";
            }

            console.log("Index Result:", idxJson);

            // Test 2: Specific Patient
            fetch(GAS_API_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'get_patient_history',
                    id: testId,
                    code: testId,
                    name: "DEBUG_TEST"
                })
            })
                .then(r => r.json())
                .then(json => {
                    console.log("Details Result:", json);
                    let msg = idxMsg + "\nDETAILS CHECK:\n";

                    if (json.history === undefined) {
                        msg += "CRITICAL: 'history' missing. Update Backend Code.\n";
                    } else {
                        msg += `History Records: ${json.history.length}\n`;
                        if (json.history.length > 0) msg += "âœ… Details Fetch Success.";
                        else msg += "âš ï¸ Details Empty.";
                    }

                    alert(msg);
                })
                .catch(e => alert("Details Error: " + e.message));
        })
        .catch(e => alert("Index Error: " + e.message));
}

// Check History Index on Startup
loadHistoryIndex();

// Notify User of Update
setTimeout(() => {
    if (appData.historyIndex.ids.size === 0) console.log("System V2 Loaded - Index Empty (Wait for fetch)");
}, 2000);

// --- Image Upload Logic ---

function renderLabImages() {
    const container = document.getElementById('modal-lab-images');
    if (!container) return; // Should exist if modal matches structure

    container.innerHTML = '';

    const images = appData.currentPatient.labImages || [];

    // Grid of Images
    if (images.length > 0) {
        const grid = document.createElement('div');
        grid.className = "grid grid-cols-2 md:grid-cols-4 gap-4 mb-4";

        images.forEach((img, idx) => {
            const card = document.createElement('div');
            card.className = "relative group rounded-lg overflow-hidden border border-slate-200 shadow-sm bg-white cursor-pointer hover:shadow-md transition-all";

            // Use 'thumbnail' endpoint for reliable preview, fall back to direct ID
            const thumbUrl = `https://drive.google.com/thumbnail?id=${img.id}&sz=w800`;
            // USE THUMBNAIL ENDPOINT FOR FULL VIEW TOO (More reliable than uc?export=view)
            const fullUrl = `https://drive.google.com/thumbnail?id=${img.id}&sz=w3000`; // Request huge size for lightbox

            card.innerHTML = `
                <div class="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
                    <img src="${thumbUrl}" class="w-full h-full object-cover transition-transform group-hover:scale-105" 
                         onerror="this.src='https://placehold.co/600x400?text=Scan+QR+to+View'; this.onerror=null;" 
                         alt="Lab Image">
                </div>
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    <button class="p-3 bg-white rounded-full text-slate-800 hover:text-blue-600 shadow-lg btn-view-img transform hover:scale-110 transition-transform" title="View">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="p-3 bg-white rounded-full text-slate-800 hover:text-red-600 shadow-lg btn-delete-img transform hover:scale-110 transition-transform" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;

            // View Lightbox
            card.querySelector('.btn-view-img').onclick = (e) => {
                e.stopPropagation();
                openImageLightbox(fullUrl);
            };

            // Also click on card opens lightbox
            card.onclick = () => openImageLightbox(fullUrl);


            // Delete Logic
            card.querySelector('.btn-delete-img').onclick = (e) => {
                e.stopPropagation();
                if (confirm("Remove this image?")) {
                    images.splice(idx, 1);
                    appData.currentPatient.labImages = images;
                    triggerSave();
                    renderLabImages();
                }
            };

            container.appendChild(card);
        });

        container.appendChild(grid);
    }

    // Paste/Upload Area
    const uploadArea = document.createElement('div');
    uploadArea.id = "paste-area";
    uploadArea.className = "border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-slate-400 bg-slate-50 hover:bg-slate-100 hover:border-medical-400 hover:text-medical-600 transition-all cursor-pointer relative group text-center";
    uploadArea.tabIndex = 0; // Make focusable

    // Hidden File Input for Mobile/Click Support
    const textDesc = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "Tap to Upload Image" : "Paste or Click to Upload";

    uploadArea.innerHTML = `
        <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform text-2xl">
            <i class="fa-solid fa-cloud-arrow-up"></i>
        </div>
        <h4 class="font-bold text-sm uppercase tracking-wider">${textDesc}</h4>
        <p class="text-[10px] opacity-70 mb-0 hidden md:block">(Ctrl+V or Click)</p>
        <input type="file" id="img-file-input" accept="image/*" class="hidden">
        
        <div id="upload-status" class="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center text-medical-600 font-bold hidden z-10 flex-col">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i> 
            <span>Uploading...</span>
        </div>
    `;

    // Event: Paste (Desktop)
    uploadArea.addEventListener('paste', handleImagePaste);

    // Event: Click (Mobile/Desktop File Picker)
    uploadArea.onclick = (e) => {
        if (e.target.id !== 'img-file-input') {
            document.getElementById('img-file-input').click();
        }
    };

    // Event: File Selected
    setTimeout(() => {
        const fileInp = document.getElementById('img-file-input');
        if (fileInp) {
            fileInp.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    uploadImage(e.target.files[0]);
                }
            };
        }
    }, 0);

    container.appendChild(uploadArea);
}

// --- Lightbox Logic ---
// --- Lightbox Variables ---
let lightboxState = {
    scale: 1,
    panning: false,
    pointX: 0,
    pointY: 0,
    startX: 0,
    startY: 0
};

function openImageLightbox(url) {
    // Reset State
    lightboxState = { scale: 1, panning: false, pointX: 0, pointY: 0, startX: 0, startY: 0 };

    // Check if lightbox exists
    let lightbox = document.getElementById('lightbox-modal');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'lightbox-modal';
        lightbox.className = 'fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center animate-fade-in hidden';
        lightbox.innerHTML = `
            <!-- Toolbar -->
            <div class="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 z-30 bg-black/50 backdrop-blur-md rounded-full px-6 py-2 border border-white/10">
                <button onclick="resetLightboxZoom()" class="text-white/70 hover:text-white transition-colors flex items-center gap-2 text-sm font-bold">
                    <i class="fa-solid fa-expand"></i> Reset
                </button>
            </div>

            <button onclick="closeImageLightbox()" class="absolute top-4 right-4 text-white/50 hover:text-white transition-colors z-20">
                <i class="fa-solid fa-times text-4xl"></i>
            </button>
            
            <div class="relative group overflow-hidden w-full h-full flex items-center justify-center" id="lightbox-container">
                <img id="lightbox-img" src="" class="max-w-none max-h-none object-contain shadow-2xl transition-transform duration-100 ease-out origin-center cursor-grab" style="max-width: 95vw; max-height: 95vh;" />
            </div>
            
            <div class="absolute bottom-4 text-white/50 text-xs hidden lg:block" id="lightbox-hint">Scroll to Zoom &bull; Drag to Pan</div>
        `;
        // Close on background click (only if not panning)
        lightbox.onclick = (e) => {
            if (e.target === lightbox && !lightboxState.panning) closeImageLightbox();
        };
        document.body.appendChild(lightbox);

        // Attach Events
        setupPanZoom();
    }

    const img = document.getElementById('lightbox-img');

    img.src = url;

    updateLightboxUI();

    lightbox.classList.remove('hidden');
}

function updateLightboxUI() {
    const img = document.getElementById('lightbox-img');
    const hint = document.getElementById('lightbox-hint');

    // Pan Mode
    hint.textContent = "Scroll to Zoom â€¢ Drag to Pan";
    img.style.cursor = lightboxState.panning ? 'grabbing' : 'grab';

    // Apply Transform
    img.style.transform = `translate(${lightboxState.pointX}px, ${lightboxState.pointY}px) scale(${lightboxState.scale})`;
}

function resetLightboxZoom() {
    lightboxState.scale = 1;
    lightboxState.pointX = 0;
    lightboxState.pointY = 0;
    updateLightboxUI();
}

function setupPanZoom() {
    const container = document.getElementById('lightbox-container');
    const img = document.getElementById('lightbox-img');

    if (!container || !img) return;

    // Wheel Zoom
    container.addEventListener('wheel', (e) => {
        e.preventDefault();

        const xs = (e.clientX - lightboxState.pointX) / lightboxState.scale;
        const ys = (e.clientY - lightboxState.pointY) / lightboxState.scale;

        const delta = -Math.sign(e.deltaY);
        // Smoother zoom step
        const step = 0.15;

        let newScale = lightboxState.scale + (delta * step * lightboxState.scale);
        if (newScale < 0.5) newScale = 0.5;
        if (newScale > 10) newScale = 10;

        lightboxState.pointX = e.clientX - xs * newScale;
        lightboxState.pointY = e.clientY - ys * newScale;
        lightboxState.scale = newScale;

        updateLightboxUI();
    });

    // Panning
    img.addEventListener('mousedown', (e) => {
        e.preventDefault();
        lightboxState.panning = true;
        lightboxState.startX = e.clientX - lightboxState.pointX;
        lightboxState.startY = e.clientY - lightboxState.pointY;
        img.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!lightboxState.panning) return;
        e.preventDefault();
        lightboxState.pointX = e.clientX - lightboxState.startX;
        lightboxState.pointY = e.clientY - lightboxState.startY;
        updateLightboxUI();
    });

    window.addEventListener('mouseup', () => {
        if (lightboxState.panning) {
            lightboxState.panning = false;
            img.style.cursor = 'grab';
        }
    });
}

function closeImageLightbox() {
    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox) {
        const img = document.getElementById('lightbox-img');
        // Reset scale animation
        img.style.transform = 'scale(0.95)';
        setTimeout(() => {
            lightbox.classList.add('hidden');
            img.src = ''; // Clear to stop loading
        }, 200);
    }
}



// --- Paste Handlers ---
async function handleImagePaste(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let file = null;

    // Find image in clipboard
    for (let item of items) {
        if (item.type.indexOf("image") === 0) {
            file = item.getAsFile();
            break;
        }
    }

    if (!file) return; // Not an image paste

    e.preventDefault();

    // Valid Image found
    uploadImage(file);
}



function uploadImage(file) {
    const status = document.getElementById('upload-status');
    if (status) status.classList.remove('hidden');

    uploadFileToBackend(file);
}

async function uploadFileToBackend(file) {
    const status = document.getElementById('upload-status');
    if (status) status.classList.remove('hidden');

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
        const base64 = reader.result;

        try {
            // Use standard fetch (awaiting CORS headers from GAS)
            const res = await fetch(GAS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain avoids OPTIONS postflight
                body: JSON.stringify({
                    action: 'upload_image',
                    image: base64, // Full data URI
                    filename: 'paste_' + Date.now() + '.png'
                })
            });

            const json = await res.json();

            if (json.status === 'success') {
                if (!appData.currentPatient.labImages) appData.currentPatient.labImages = [];
                appData.currentPatient.labImages.push({
                    url: json.url,
                    id: json.fileId, // Use ID for reliable thumbnail
                    name: json.name
                });

                triggerSave();
                renderLabImages();
            } else {
                alert("Upload failed: " + (json.error || json.message));
            }

        } catch (e) {
            console.error(e);
            alert("Upload Error. Please check your internet or Script deployment.");
        } finally {
            if (status) status.classList.add('hidden');
        }
    };
}


// --------------------------------------------------------
// SYMPTOMS ASSESSMENT MODAL LOGIC
// --------------------------------------------------------
let tempSymptoms = {}; // Local state for the modal
const COMMON_SYMPTOMS = [
    'Pain', 'Nausea', 'Vomiting', 'Dyspnea', 'Constipation',
    'Delirium', 'Agitation', 'Fatigue', 'Anorexia', 'Anxiety',
    'Depression', 'Insomnia', 'Cough', 'Dry Mouth', 'Pruritus'
];

function openSymptomsModal(patient) {
    if (!patient) return;
    appData.currentPatient = patient; // Ensure context

    // Parse Existing
    tempSymptoms = {};
    if (patient.symptoms) {
        // Deep copy to avoid mutating direct reference until save
        try {
            const raw = (typeof patient.symptoms === 'string') ? JSON.parse(patient.symptoms) : patient.symptoms;
            tempSymptoms = JSON.parse(JSON.stringify(raw));
        } catch (e) {
            console.warn("Error parsing symptoms", e);
            tempSymptoms = {};
        }
    }

    // UI Init
    document.getElementById('sys-patient-name').textContent = patient.name;
    document.getElementById('symptoms-modal').classList.remove('hidden');
    renderSymptomsUI();
}

function closeSymptomsModal() {
    document.getElementById('symptoms-modal').classList.add('hidden');
}

function renderSymptomsUI() {
    const activeList = document.getElementById('sys-active-list');
    const quickGrid = document.getElementById('sys-quick-add');

    // 1. Render Active List
    activeList.innerHTML = '';
    const activeKeys = Object.keys(tempSymptoms).filter(k => tempSymptoms[k] && tempSymptoms[k].active);

    if (activeKeys.length === 0) {
        activeList.innerHTML = '<div class="text-center text-slate-400 text-sm py-4 italic">No active symptoms reported.</div>';
    } else {
        activeKeys.forEach(k => {
            const item = tempSymptoms[k];
            const div = document.createElement('div');
            div.className = "flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 animate-entry";
            div.innerHTML = `
                <div class="w-10 h-10 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 font-bold text-lg">
                    ${k.charAt(0)}
                </div>
                <div class="flex-1">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-bold text-slate-700">${k}</span>
                        <button onclick="removeSymptom('${k}')" class="text-slate-400 hover:text-red-500 text-xs">
                            <i class="fa-solid fa-trash"></i> Remove
                        </button>
                    </div>
                    <input type="text" 
                        oninput="updateSymptomNote('${k}', this.value)" 
                        value="${item.note || ''}" 
                        placeholder="Add note (severity, frequency...)" 
                        class="w-full bg-white border border-slate-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-rose-400 outline-none">
                </div>
            `;
            activeList.appendChild(div);
        });
    }

    // 2. Render Quick Add (exclude already active)
    quickGrid.innerHTML = '';
    COMMON_SYMPTOMS.forEach(s => {
        if (tempSymptoms[s] && tempSymptoms[s].active) return; // Skip if active

        const btn = document.createElement('button');
        btn.className = "p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:border-rose-400 hover:text-rose-600 transition-colors truncate";
        btn.textContent = s;
        btn.onclick = () => addSymptom(s);
        quickGrid.appendChild(btn);
    });
}

function addSymptom(name) {
    if (!tempSymptoms[name]) {
        tempSymptoms[name] = { active: true, note: '' };
    } else {
        tempSymptoms[name].active = true;
    }
    renderSymptomsUI();
}

function addCustomSymptom() {
    const input = document.getElementById('sys-custom-input');
    const val = input.value.trim();
    if (val) {
        // Capitalize first letter
        const name = val.charAt(0).toUpperCase() + val.slice(1);
        addSymptom(name);
        input.value = '';
    }
}

function removeSymptom(name) {
    if (tempSymptoms[name]) {
        tempSymptoms[name].active = false;
        renderSymptomsUI();
    }
}

function updateSymptomNote(name, note) {
    if (tempSymptoms[name]) {
        tempSymptoms[name].note = note;
    }
}

function saveSymptomsData() {
    if (!appData.currentPatient) return;

    // Direct Object Update (No Stringify needed for appData, but maybe for GAS?)
    // Our sync mechanism usually saves valid JSON objects as Strings if the backend requires it, 
    // OR if we are using the simple CSV mapping, it might need to check triggerSave logic.
    // Assuming TriggerSave serializes efficiently or backend handles it.
    // Based on `renderModalLabs`, logic seems to support JSON stored in column.

    appData.currentPatient.symptoms = tempSymptoms;

    // Update UI immediately
    renderPatientsGrid(appData.wards[appData.currentWard]);

    // Save
    triggerSave();

    closeSymptomsModal();
}

// --------------------------------------------------------
// CRITICAL LABS MODAL LOGIC (Refactored)
// --------------------------------------------------------
let currentLabView = 'image'; // 'image' or 'manual'

function openLabsModal(patient) {
    if (!patient) return;
    appData.currentPatient = patient;
    document.getElementById('lab-patient-name').textContent = patient.name;

    // Default View
    switchLabsView('image');

    // Setup Manual Grid (using existing logic repurposed)
    renderNewLabsGrid(patient.labs);

    // Load recent images
    renderLabsRecentImages();

    document.getElementById('labs-modal').classList.remove('hidden');

    // Focus Image Paste Target
    setTimeout(() => {
        const target = document.getElementById('labs-paste-target');
        if (target) target.focus();
    }, 100);
}

function closeLabsModal() {
    document.getElementById('labs-modal').classList.add('hidden');
}

function switchLabsView(view) {
    currentLabView = view;
    const btnImg = document.getElementById('btn-labs-view-image');
    const btnMan = document.getElementById('btn-labs-view-manual');
    const viewImg = document.getElementById('labs-view-image');
    const viewMan = document.getElementById('labs-view-manual');

    // Reset styles
    if (btnImg) btnImg.className = "px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-2 text-slate-500 hover:bg-slate-50";
    if (btnMan) btnMan.className = "px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-2 text-slate-500 hover:bg-slate-50";

    if (view === 'image') {
        if (btnImg) btnImg.className = "px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-2 bg-blue-100 text-blue-700";
        if (viewImg) viewImg.classList.remove('hidden');
        if (viewMan) viewMan.classList.add('hidden');
        // Focus for paste
        setTimeout(() => document.getElementById('labs-paste-target')?.focus(), 50);
    } else {
        if (btnMan) btnMan.className = "px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-2 bg-blue-100 text-blue-700";
        if (viewMan) viewMan.classList.remove('hidden');
        if (viewImg) viewImg.classList.add('hidden');
    }
}

// Paste Handler for Labs (Image)
document.addEventListener('paste', (e) => {
    // Only if Labs Modal Image View is open
    const modal = document.getElementById('labs-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (currentLabView !== 'image') return;

    // Check for image
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let blob = null;
    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            blob = item.getAsFile();
            break;
        }
    }
    if (blob) {
        e.preventDefault();
        handleLabsImageUpload(blob);
    }
});



function renderLabsRecentImages() {
    const list = document.getElementById('labs-recent-list');
    if (!list) return;
    list.innerHTML = '';
    const images = appData.currentPatient.labImages || [];

    images.slice().reverse().forEach(img => {
        const div = document.createElement('div');
        div.className = "aspect-square rounded-lg border border-slate-200 bg-slate-100 overflow-hidden relative cursor-pointer group";
        div.innerHTML = "<img src='" + img.url + "' class='w-full h-full object-cover'><div class='absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center'><i class='fa-solid fa-eye text-white opacity-0 group-hover:opacity-100 drop-shadow-md'></i></div>";
        div.onclick = () => openImageLightbox(img.url);
        list.appendChild(div);
    });
}

function renderNewLabsGrid(labs) {
    const container = document.getElementById('labs-manual-grid');
    if (!container) return;
    container.innerHTML = '';

    // Robust parsing for Labs
    if (typeof labs === 'string') {
        try { labs = JSON.parse(labs); } catch (e) { labs = {}; }
    }
    if (!labs || typeof labs !== 'object' || Array.isArray(labs)) {
        labs = {};
    }

    const standardKeys = ["CL", "K", "NA", "TB", "DB", "ALB", "MG", "PH", "CA", "CRP", "SGOT", "SGPT", "ALP", "LDH", "SCR", "BUN", "WBC", "RBC", "HGB", "PLT"];

    standardKeys.forEach(key => {
        const lData = labs[key] || { value: '', unit: '' };
        const val = lData.value;
        const range = appData.ranges[key] || [0, 0];
        const [min, max] = range;

        // Status Logic
        let statusClass = "text-slate-800 border-slate-300";
        if (val) {
            const num = parseFloat(val);
            if (!isNaN(num)) {
                if (num < min) statusClass = "text-blue-600 border-blue-400 font-bold bg-blue-50";
                else if (num > max) statusClass = "text-red-600 border-red-400 font-bold bg-red-50";
                else statusClass = "text-emerald-600 border-emerald-400 bg-emerald-50";
            }
        }

        const div = document.createElement('div');
        div.className = "p-3 rounded-xl border " + (val ? '' : 'border-slate-100') + " bg-white flex flex-col items-center justify-between h-24 hover:shadow-sm transition-all";

        div.innerHTML = "<label class='text-xs font-bold text-slate-400 uppercase'>" + key + "</label>" +
            "<input type='text' value='" + (val || '') + "' " +
            "class='w-full text-center bg-transparent text-lg font-bold focus:outline-none border-b border-transparent focus:border-blue-400 " + statusClass + "' " +
            "onchange=\"updateLabValue('" + key + "', this.value)\">" +
            "<span class='text-[9px] text-slate-300 font-mono'>" + min + "-" + max + "</span>";
        container.appendChild(div);
    });
}

function updateLabValue(key, value) {
    if (!appData.currentPatient.labs) appData.currentPatient.labs = {};
    // Ensure object type if previously string
    if (typeof appData.currentPatient.labs === 'string') {
        try {
            appData.currentPatient.labs = JSON.parse(appData.currentPatient.labs);
        } catch (e) { appData.currentPatient.labs = {}; }
    }

    if (!appData.currentPatient.labs[key]) appData.currentPatient.labs[key] = {};
    appData.currentPatient.labs[key].value = value;
}

function saveLabsData() {
    triggerSave();
    closeLabsModal();
    renderPatientsGrid(appData.wards[appData.currentWard]);
}

function toggleCalc() {
    alert('Corrected Calcium formula coming soon.');
}




// ----------------------------------------------------------------------
// HELPER: Simulate Backend Upload (Convert to DataURL for Local Usage)
// ----------------------------------------------------------------------
function uploadFileToBackend(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result); // Resolve with Data URL
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
    });
}

// ----------------------------------------------------------------------
// LABS IMAGE HANDLER (Fixed)
// ----------------------------------------------------------------------
async function handleLabsImageUpload(file) {
    if (!file) return;

    const container = document.getElementById('labs-paste-target');
    const originalContent = container ? container.innerHTML : '';

    try {
        // 1. Show Loading UI
        if (container) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 animate-pulse">
                    <i class="fa-solid fa-circle-notch fa-spin text-4xl text-blue-500 mb-3"></i>
                    <p class="text-blue-600 font-bold">Processing Image...</p>
                </div>`;
        }

        // 2. "Upload" (Convert to Base64)
        const dataUrl = await uploadFileToBackend(file);

        // 3. Store in AppData
        if (!appData.currentPatient.labImages) appData.currentPatient.labImages = [];

        // Add new image with timestamp
        appData.currentPatient.labImages.push({
            id: Date.now().toString(),
            url: dataUrl,
            date: new Date().toISOString()
        });

        // 4. Update Recent Images UI
        renderLabsRecentImages();

        // 5. Success Feedback / Reset
        if (container) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 text-emerald-600 animate-entry">
                    <i class="fa-solid fa-check-circle text-4xl mb-3"></i>
                    <p class="font-bold">Upload Complete!</p>
                </div>`;

            // Restore original upload prompt after 1.5s
            setTimeout(() => {
                if (container) container.innerHTML = `
                    <div class="space-y-4">
                        <div class="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mx-auto text-slate-400 group-hover:text-blue-500 transition-colors">
                            <i class="fa-solid fa-cloud-arrow-up text-3xl"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-slate-700 text-lg">Click to Upload</h3>
                            <p class="text-slate-500 text-sm">or Ctrl+V to Paste Image</p>
                        </div>
                    </div>`;
            }, 1500);
        }

        // 6. Trigger background save
        triggerSave();

    } catch (error) {
        console.error("Upload failed", error);
        if (container) {
            container.innerHTML = `
                    < div class="flex flex-col items-center justify-center py-10 text-red-500" >
                    <i class="fa-solid fa-triangle-exclamation text-4xl mb-3"></i>
                    <p class="font-bold">Upload Failed</p>
                    <button onclick="switchLabsView('image')" class="mt-2 text-xs underline">Try Again</button>
                </div > `;
        }
    }
}

// ==========================================
// INTEGRATION: External App Handoffs (HVC & PE)
// ==========================================

/**
 * Builds the URL Query String from Patient Data
 */
function constructPatientQueryParams(p) {
    if (!p) return '';
    const params = new URLSearchParams();

    // Core Data
    if (p.name) params.append('name', p.name);
    if (p.code) params.append('id', p.code); // Map 'code' to 'id' if target expects 'id'
    if (p.age) params.append('age', p.age);
    if (p.diagnosis) params.append('diagnosis', p.diagnosis);
    if (p.ward) params.append('ward', p.ward);
    if (p.room) params.append('room', p.room);

    // Context
    params.append('source', 'palliative_hub');
    params.append('mode', 'new'); // Signal to open "New Record" mode

    return params.toString();
}



// --------------------------------------------------------
// INTEGRATION: Embedded Forms (HVC & PE)
// --------------------------------------------------------

// Config - Destination URLs
const HVC_API_URL = "https://script.google.com/macros/s/AKfycbzKCvkaQ8sDBoYCTWd9K4Rt9L4MPK3p1llGZwDT5nd5E33NeRen1l973EtFQyI42FvQ/exec";
const PE_API_URL = "https://script.google.com/macros/s/AKfycbwjwZcOtRy0SmgBZABxPVDE30NHD2y_Tfu8py5P_VmETiPZz07QHleM7vTQYWyaZQB2/exec";

function fetchHVCPatients() {
    console.log("Fetching HVC Patient List...");
    const url = HVC_API_URL + "?action=get_patient_list";

    fetch(url, {
        method: 'GET',
        mode: 'cors'
    })
        .then(res => res.json())
        .then(data => {
            // Robustly identify the list
            let list = [];
            if (Array.isArray(data)) {
                list = data;
            } else if (data && data.patients && Array.isArray(data.patients)) {
                list = data.patients;
            } else if (data && data.data && Array.isArray(data.data)) {
                list = data.data;
            }

            if (list.length > 0) {
                console.log("HVC List Loaded:", list.length);

                // Store IDs for quick lookup (ensure string)
                appData.hvcList = list.map(p => {
                    let val = p;
                    if (typeof p === 'object' && p !== null) {
                        // Prioritize "Pt file Num." as requested by user, then others
                        val = p['Pt file Num.'] || p['File Num.'] || p['code'] || p['id'] || p['ID'] || p['File_No'] || Object.values(p)[0];
                    }
                    // Strip non-digits for comparison (e.g. PAT123 -> 123)
                    return String(val || '').replace(/\D/g, '');
                }).filter(id => id.length > 0);

                console.log("HVC Parsed IDs:", appData.hvcList.slice(0, 5));

                // Re-render grid if data is already loaded to show badges
                if (appData.currentWard && appData.wards[appData.currentWard]) {
                    if (typeof renderPatientsGrid === 'function') {
                        renderPatientsGrid(appData.wards[appData.currentWard]);
                    }
                }
            } else {
                console.warn("HVC List Fetch Failed or Empty", data);
            }
        })
        .catch(e => console.warn("HVC Fetch Error (Offline?)", e));
}

// --- Home Visit Logic ---

function openHVCModal() {
    if (!appData.currentPatient) return;
    const p = appData.currentPatient;

    // Pre-fill
    document.getElementById('hvc-name').value = p.name || '';
    document.getElementById('hvc-id').value = p.code || ''; // File Num
    document.getElementById('hvc-age').value = p.age || '';
    document.getElementById('hvc-diagnosis-detail').value = p.diagnosis || '';
    document.getElementById('hvc-date-reg').valueAsDate = new Date();

    // Show
    const modal = document.getElementById('hvc-modal');
    modal.classList.remove('hidden');
}

function closeHVCModal() {
    document.getElementById('hvc-modal').classList.add('hidden');
}

async function submitHVCForm() {
    const btn = document.querySelector('#hvc-modal button[onclick="submitHVCForm()"]');
    const statusDiv = document.getElementById('hvc-status');

    // UI Loading
    btn.disabled = true;
    btn.classList.add('opacity-50');
    statusDiv.classList.remove('hidden');

    // FIXED: Action must be 'register' to match Backend
    const payload = {
        action: 'register',
        data: {
            'Pt Name': document.getElementById('hvc-name').value,
            'Pt file Num.': document.getElementById('hvc-id').value,
            'Gender': document.getElementById('hvc-gender').value,
            'Age': document.getElementById('hvc-age').value,
            'phone No.': document.getElementById('hvc-phone').value,
            'Social Status': document.getElementById('hvc-social').value,
            'City/Area (Adress)': document.getElementById('hvc-city').value,
            'Specific Home Address': document.getElementById('hvc-address').value,
            'Hospital': document.getElementById('hvc-hospital').value,
            'Primary Physician': document.getElementById('hvc-doctor').value,
            'Diagnosis': document.getElementById('hvc-diagnosis-cat').value,
            'Specific Diagnosis': document.getElementById('hvc-diagnosis-detail').value,
            'Opioid?': document.getElementById('hvc-opioid').value,
            'Priority': document.getElementById('hvc-priority').value,
            'ECGO': document.getElementById('hvc-ecog').value,
            'PPI': document.getElementById('hvc-ppi').value,
            'PPS': document.getElementById('hvc-pps').value,
            'Registration Date': document.getElementById('hvc-date-reg').value,
            'Servival Status': 'Alive'
        }
    };

    try {
        await fetch(HVC_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        saveQuickPlan('referral', `Registered in HVC: ${payload.data['Pt Name']}`);

        // Update Local State (Immediate Feedback)
        const newId = document.getElementById('hvc-id').value;
        if (newId && appData.hvcList) {
            appData.hvcList.push(String(newId).trim());
            // Re-render if grid is active
            if (appData.currentWard && appData.wards && appData.wards[appData.currentWard]) {
                if (typeof renderPatientsGrid === 'function') {
                    renderPatientsGrid(appData.wards[appData.currentWard]);
                }
            }
        }

        closeHVCModal();
        alert("Patient registered in Home Visit system successfully!");

    } catch (e) {
        console.error("HVC Submit Error", e);
        alert("Failed to submit to Home Visit App. Check console.");
    } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
        statusDiv.classList.add('hidden');
    }
}


// --- Equipment Logic ---

function openPEModal(requestedDevice = '') {
    if (!appData.currentPatient) return;
    const p = appData.currentPatient;

    // Pre-fill
    document.getElementById('pe-name').value = p.name || '';
    document.getElementById('pe-id').value = p.code || '';
    document.getElementById('pe-diagnosis').value = p.diagnosis || '';

    if (requestedDevice) {
        document.getElementById('pe-device').value = requestedDevice;
    }

    document.getElementById('pe-date-delivery').valueAsDate = new Date();

    // Show
    const modal = document.getElementById('pe-modal');
    modal.classList.remove('hidden');
}

function closePEModal() {
    document.getElementById('pe-modal').classList.add('hidden');
}

async function submitPEForm() {
    const btn = document.querySelector('#pe-modal button[onclick="submitPEForm()"]');
    const statusDiv = document.getElementById('pe-status-msg');

    // UI Loading
    btn.disabled = true;
    btn.classList.add('opacity-50');
    statusDiv.classList.remove('hidden');

    // FIXED: Payload must match 'addTransaction' schema (flat structure, specific keys)
    const payload = {
        action: 'addTransaction',
        patientName: document.getElementById('pe-name').value,
        patientId: document.getElementById('pe-id').value,
        diagnosis: document.getElementById('pe-diagnosis').value,
        area: document.getElementById('pe-area').value,
        contact: document.getElementById('pe-phone').value,
        recipientName: document.getElementById('pe-recipient').value,
        recipientId: document.getElementById('pe-recipient-id').value,
        relationship: document.getElementById('pe-relationship').value,
        device: document.getElementById('pe-device').value,
        status: document.getElementById('pe-status').value, // 'Pending' | 'Delivered'
        notes: document.getElementById('pe-notes').value,

        // Defaults/Derivations
        timestamp: new Date().toISOString(),
        deviceNumber: '', // Not collected in form
        type: 'New'       // Default to New request
    };

    try {
        await fetch(PE_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 1. Save Local Plan
        saveQuickPlan('equipment', `Requested Equipment: ${payload.device}`);

        // 2. Close & Reset
        closePEModal();
        alert("Equipment record saved successfully!");

    } catch (e) {
        console.error("PE Submit Error", e);
        alert("Failed to submit to Equipment App. Check console.");
    } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
        statusDiv.classList.add('hidden');
    }
}

// Global Exports
window.openHVCModal = openHVCModal;
window.closeHVCModal = closeHVCModal;
window.submitHVCForm = submitHVCForm;
window.openPEModal = openPEModal;
window.closePEModal = closePEModal;
window.submitPEForm = submitPEForm;


