// ----- MEETING NOTES & STUDY MODULE -----

// Ensure appData.notes exists
if (!appData.notes) {
    appData.notes = [];
}

let currentEditingNoteId = null;

function openNotesView() {
    // Hide other views
    const pg = document.getElementById('patient-grid-container');
    if (pg) pg.classList.add('hidden');

    const wb = document.getElementById('welcome-banner');
    if (wb) wb.classList.add('hidden');

    // If Analytics or History were open, hide them
    const analytics = document.getElementById('analytics-view');
    if (analytics) analytics.classList.add('hidden');
    const history = document.getElementById('history-view');
    if (history) history.classList.add('hidden');

    // Show Notes View
    const notesView = document.getElementById('notes-view');
    if (notesView) notesView.classList.remove('hidden');

    renderNotesView();
}

function renderNotesView() {
    const grid = document.getElementById('notes-grid');
    const emptyState = document.getElementById('notes-empty-state');
    const searchTerm = document.getElementById('notes-search').value.toLowerCase();
    const filterType = document.getElementById('notes-filter-type').value;

    grid.innerHTML = '';

    const filteredNotes = appData.notes.filter(note => {
        const matchesSearch = (note.title || '').toLowerCase().includes(searchTerm) ||
            (note.content || '').toLowerCase().includes(searchTerm);
        const matchesType = filterType === 'all' || note.type === filterType;
        return matchesSearch && matchesType;
    });

    if (filteredNotes.length === 0) {
        emptyState.classList.remove('hidden');
        grid.classList.add('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    grid.classList.remove('hidden');

    // Sort by Date Descending
    filteredNotes.sort((a, b) => new Date(b.date) - new Date(a.date));

    filteredNotes.forEach(note => {
        const card = createNoteCard(note);
        grid.appendChild(card);
    });
}

function createNoteCard(note) {
    const div = document.createElement('div');
    // Masonry item style
    div.className = "bg-white rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow cursor-pointer overflow-hidden group break-inside-avoid mb-4";
    div.onclick = () => openNoteEditor(note.id);

    // Extract first image if exists for thumbnail
    let thumbnailHtml = '';
    // Simple regex to find img tag in content
    const imgMatch = note.content.match(/<img[^>]+src="([^">]+)"/);
    if (imgMatch) {
        thumbnailHtml = `<div class="h-32 w-full bg-slate-100 overflow-hidden">
            <img src="${imgMatch[1]}" class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity">
        </div>`;
    }

    // Type Badge Color
    const typeColors = {
        meeting: 'bg-blue-100 text-blue-700',
        study: 'bg-purple-100 text-purple-700',
        pearl: 'bg-amber-100 text-amber-700',
        guideline: 'bg-green-100 text-green-700'
    };
    const badgeClass = typeColors[note.type] || 'bg-slate-100 text-slate-600';
    const typeLabel = note.type.charAt(0).toUpperCase() + note.type.slice(1);

    // Extract text snippet (strip HTML)
    const tmp = document.createElement("DIV");
    tmp.innerHTML = note.content;
    const textContent = tmp.textContent || tmp.innerText || "";
    const snippet = textContent.length > 100 ? textContent.substring(0, 100) + '...' : textContent;

    div.innerHTML = `
        ${thumbnailHtml}
        <div class="p-4">
            <h4 class="font-bold text-slate-800 mb-2 leading-tight">${note.title || 'Untitled Note'}</h4>
            <p class="text-sm text-slate-500 mb-3 line-clamp-3">${snippet || '<i>No text content</i>'}</p>
            <div class="flex justify-between items-center mt-2">
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${badgeClass}">
                    ${typeLabel}
                </span>
                <span class="text-xs text-slate-400">${new Date(note.date).toLocaleDateString()}</span>
            </div>
        </div>
    `;

    return div;
}

function openNoteEditor(noteId = null) {
    currentEditingNoteId = noteId;
    const modal = document.getElementById('note-editor-modal');
    const titleInput = document.getElementById('note-title-input');
    const typeSelect = document.getElementById('note-type-select');
    const contentEditor = document.getElementById('note-content-editor');
    const dateDisplay = document.getElementById('note-date-display');
    const btnDelete = document.getElementById('btn-delete-note');

    if (noteId) {
        // Edit Mode
        const note = appData.notes.find(n => n.id === noteId);
        if (!note) return; // Should not happen

        titleInput.value = note.title;
        typeSelect.value = note.type;
        contentEditor.innerHTML = note.content;
        dateDisplay.innerText = new Date(note.date).toLocaleDateString();
        btnDelete.classList.remove('hidden');
    } else {
        // New Mode
        titleInput.value = '';
        typeSelect.value = 'study'; // Default
        contentEditor.innerHTML = '';
        dateDisplay.innerText = new Date().toLocaleDateString();
        btnDelete.classList.add('hidden');
    }

    modal.classList.remove('hidden');
}

function closeNoteEditor() {
    document.getElementById('note-editor-modal').classList.add('hidden');
    currentEditingNoteId = null;
}

function saveNote() {
    const title = document.getElementById('note-title-input').value;
    const type = document.getElementById('note-type-select').value;
    const content = document.getElementById('note-content-editor').innerHTML;

    // Basic Validation
    if (!title.trim() && !content.trim()) {
        closeNoteEditor(); // Just close if empty
        return;
    }

    if (currentEditingNoteId) {
        // Update
        const index = appData.notes.findIndex(n => n.id === currentEditingNoteId);
        if (index !== -1) {
            appData.notes[index] = {
                ...appData.notes[index],
                title,
                type,
                content,
                updatedAt: new Date().toISOString()
            };
        }
    } else {
        // Create
        const newNote = {
            id: Date.now().toString(),
            title: title || 'Untitled Note',
            type,
            content,
            date: new Date().toISOString(),
            images: [],
            updatedAt: new Date().toISOString()
        };
        appData.notes.push(newNote);
    }

    closeNoteEditor();
    renderNotesView();
    // Async Sync
    syncNotesToBackend();
}

function deleteCurrentNote() {
    if (!currentEditingNoteId) return;

    if (confirm("Are you sure you want to delete this note?")) {
        appData.notes = appData.notes.filter(n => n.id !== currentEditingNoteId);
        renderNotesView();
        closeNoteEditor();
        syncNotesToBackend();
    }
}

// --- SYNC & IMAGE LOGIC ---

async function syncNotesToBackend() {
    const status = document.getElementById('save-status'); // reuse main status
    if (status) status.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing Notes...';

    // 1. Process Images in all notes
    // We need to find any base64 images, upload them, and replace with URL
    // This ensures lightweight JSON for the sheet

    let changesMade = false;

    for (let note of appData.notes) {
        if (note.content.includes('data:image')) {
            // Parse Content
            const div = document.createElement('div');
            div.innerHTML = note.content;
            const imgs = div.querySelectorAll('img');

            for (let img of imgs) {
                if (img.src.startsWith('data:image')) {
                    // Convert to File
                    const file = dataURLtoFile(img.src, `note_img_${Date.now()}.png`);

                    // Upload (Reusing main.js function if available, else standard fetch)
                    try {
                        let url = null;
                        if (typeof uploadFileToBackend === 'function') {
                            // uploadFileToBackend (main.js) resolves with the full
                            // backend response { status, url, fileId, name } - unwrap .url.
                            const uploadResult = await uploadFileToBackend(file);
                            url = uploadResult && uploadResult.url;
                        } else {
                            console.warn("Upload function missing");
                        }

                        if (url) {
                            img.src = url;
                            changesMade = true;
                        }
                    } catch (e) {
                        console.error("Image Upload Failed", e);
                    }
                }
            }

            if (changesMade) {
                note.content = div.innerHTML;
                note.updatedAt = new Date().toISOString();
            }
        }
    }

    // 2. Save Notes Data
    try {
        const res = await fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors', // standard for GAS
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'save_notes',
                notes: appData.notes
            })
        });

        if (status) status.innerHTML = '<i class="fa-solid fa-check text-green-500"></i> Notes Saved';
        setTimeout(() => { if (status) status.innerText = ''; }, 3000);

    } catch (e) {
        console.error("Note Sync Failed", e);
        if (status) status.innerText = 'Note Sync Failed';
    }
}

// Helper: Base64 to File
function dataURLtoFile(dataurl, filename) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

// Image Paste Handler
function handleNoteImagePaste(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let blob = null;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") === 0) {
            blob = items[i].getAsFile();
            break;
        }
    }

    if (blob) {
        e.preventDefault(); // Prevent default paste behavior

        const reader = new FileReader();
        reader.onload = function (event) {
            const base64 = event.target.result;
            // Insert Image HTML at cursor
            document.execCommand('insertHTML', false, `
                <br>
                <img src="${base64}" class="max-w-full rounded-lg shadow-sm my-2 border border-slate-200">
                <br>
            `);
        };
        reader.readAsDataURL(blob);
    }
}

// Add event listeners for Search
document.getElementById('notes-search')?.addEventListener('input', renderNotesView);

// Export to Global Scope
window.openNotesView = openNotesView;
window.renderNotesView = renderNotesView;
window.createNoteCard = createNoteCard;
window.openNoteEditor = openNoteEditor;
window.closeNoteEditor = closeNoteEditor;
window.saveNote = saveNote;
window.deleteCurrentNote = deleteCurrentNote;
window.handleNoteImagePaste = handleNoteImagePaste;
window.syncNotesToBackend = syncNotesToBackend;
