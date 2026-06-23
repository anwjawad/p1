// cath-studio-adapter.js
// Bridges js/cath-studio.js (ported verbatim from jk/portcath-studio.js) to p1.
// js/cath-studio.js calls these 9 function names; jk's own app.js provided
// generic, multi-tab implementations p1 has no equivalent for. These are
// p1-only, Port-Cath-specific replacements.

// --- No-ops: these refreshed OTHER tabs/UI in jk that don't exist in p1 ---
function saveToLocalStorage() {
    // jk cached all lists to localStorage here; p1 has no such cache layer
    // for Port Cath data — freshness comes from fetchPortCathList().
}

function updateDateDropdown(type) {
    // Refreshed a date-filter <select> that only existed in jk's legacy
    // table UI, which is dead code once Port Cath Studio renders. No-op.
}

function renderDashboard() {
    // Refreshed jk's separate Dashboard tab. p1 has no such tab. No-op.
}

function renderCalendar() {
    // Refreshed jk's separate Calendar tab. p1 has no such tab. No-op.
}

// --- Notifications: p1's existing convention is plain alert() ---
function showToast(message, type, duration) {
    alert(message);
}

// --- Real backend sync, reusing the same jk Apps Script endpoint p1 already
//     talks to (PORTCATH_API_URL / PORTCATH_API_KEY, declared in js/main.js) ---
function syncAfterChange(action, type, payload) {
    let body;
    if (action === 'create') {
        body = { action: 'createRecord', key: PORTCATH_API_KEY, type: type, record: payload };
    } else if (action === 'update') {
        body = { action: 'updateRecord', key: PORTCATH_API_KEY, type: type, record: payload };
    } else if (action === 'delete') {
        body = { action: 'deleteRecord', key: PORTCATH_API_KEY, type: type, id: payload };
    } else {
        console.warn('Port Cath Studio: unknown sync action', action, type, payload);
        return;
    }

    fetch(PORTCATH_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(e => console.warn('Port Cath Studio sync error (Offline?)', action, type, e));
}

// --- Add Patient (p1-specific, simplified — no jk generic modal system) ---
function openAddModal(type) {
    if (type !== 'portcath') return;
    const dateInput = document.getElementById('pcs-add-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
    document.getElementById('pcs-add-overlay').classList.add('active');
}

function pcsCloseAddModal() {
    document.getElementById('pcs-add-overlay').classList.remove('active');
}

function pcsConfirmAdd() {
    const name = document.getElementById('pcs-add-name').value.trim();
    const fileNumber = document.getElementById('pcs-add-file').value.trim();
    const date = document.getElementById('pcs-add-date').value;
    const weight = parseFloat(document.getElementById('pcs-add-weight').value);
    const notes = document.getElementById('pcs-add-notes').value.trim();
    const phone = document.getElementById('pcs-add-phone').value.trim();
    const errEl = document.getElementById('pcs-add-err');

    if (!name || !fileNumber || !date || isNaN(weight)) {
        errEl.classList.add('visible');
        return;
    }
    errEl.classList.remove('visible');

    if (!confirm(`Add ${name} to the Port Cath schedule for ${date}?`)) return;

    const patient = {
        id: Date.now().toString(),
        name, fileNumber, date,
        day: pcsDayName(date),
        weight, notes,
        status: 'confirmed',
        ...(phone && { phone })
    };

    portCathList.push(patient);
    syncAfterChange('create', 'portcath', patient);

    document.getElementById('pcs-add-name').value = '';
    document.getElementById('pcs-add-file').value = '';
    document.getElementById('pcs-add-weight').value = '';
    document.getElementById('pcs-add-notes').value = '';
    document.getElementById('pcs-add-phone').value = '';

    pcsCloseAddModal();
    if (typeof renderPortCathStudio === 'function') renderPortCathStudio();
}

// --- Edit Patient (p1-specific, simplified) ---
let _pcsEditId = null;

function openEditPatient(type, id) {
    if (type !== 'portcath') return;
    const patient = portCathList.find(p => String(p.id) === String(id));
    if (!patient) return;
    _pcsEditId = id;

    document.getElementById('pcs-edit-name').value = patient.name || '';
    document.getElementById('pcs-edit-file').value = patient.fileNumber || '';
    document.getElementById('pcs-edit-date').value = patient.date || '';
    document.getElementById('pcs-edit-weight').value = patient.weight != null ? patient.weight : '';
    document.getElementById('pcs-edit-notes').value = patient.notes || '';
    document.getElementById('pcs-edit-err').classList.remove('visible');

    document.getElementById('pcs-edit-overlay').classList.add('active');
}

function pcsCloseEditModal() {
    document.getElementById('pcs-edit-overlay').classList.remove('active');
    _pcsEditId = null;
}

function pcsConfirmEdit() {
    const patient = portCathList.find(p => String(p.id) === String(_pcsEditId));
    if (!patient) { pcsCloseEditModal(); return; }

    const name = document.getElementById('pcs-edit-name').value.trim();
    const fileNumber = document.getElementById('pcs-edit-file').value.trim();
    const date = document.getElementById('pcs-edit-date').value;
    const weight = parseFloat(document.getElementById('pcs-edit-weight').value);
    const notes = document.getElementById('pcs-edit-notes').value.trim();
    const errEl = document.getElementById('pcs-edit-err');

    if (!name || !fileNumber || !date || isNaN(weight)) {
        errEl.classList.add('visible');
        return;
    }
    errEl.classList.remove('visible');

    patient.name = name;
    patient.fileNumber = fileNumber;
    patient.date = date;
    patient.day = pcsDayName(date);
    patient.weight = weight;
    patient.notes = notes;

    syncAfterChange('update', 'portcath', patient);

    pcsCloseEditModal();
    if (typeof renderPortCathStudio === 'function') renderPortCathStudio();
}

// --- Delete Patient (p1-specific, simplified) ---
function deletePatient(type, id) {
    if (type !== 'portcath') return;
    const patient = portCathList.find(p => String(p.id) === String(id));
    if (!patient) return;

    if (!confirm(`Delete ${patient.name} (${patient.fileNumber}) from the Port Cath schedule? This cannot be undone.`)) {
        return;
    }

    portCathList = portCathList.filter(p => String(p.id) !== String(id));
    syncAfterChange('delete', 'portcath', id);

    if (typeof renderPortCathStudio === 'function') renderPortCathStudio();
}
