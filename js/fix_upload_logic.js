
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
                if (container) container.innerHTML = \`
                    <div class="space-y-4">
                        <div class="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center mx-auto text-slate-400 group-hover:text-blue-500 transition-colors">
                            <i class="fa-solid fa-cloud-arrow-up text-3xl"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-slate-700 text-lg">Click to Upload</h3>
                            <p class="text-slate-500 text-sm">or Ctrl+V to Paste Image</p>
                        </div>
                    </div>\`;
             }, 1500);
        }

        // 6. Trigger background save
        triggerSave();

    } catch (error) {
        console.error("Upload failed", error);
        if(container) {
            container.innerHTML = `
                    < div class="flex flex-col items-center justify-center py-10 text-red-500" >
                    <i class="fa-solid fa-triangle-exclamation text-4xl mb-3"></i>
                    <p class="font-bold">Upload Failed</p>
                    <button onclick="switchLabsView('image')" class="mt-2 text-xs underline">Try Again</button>
                </div > `;
        }
    }
}
