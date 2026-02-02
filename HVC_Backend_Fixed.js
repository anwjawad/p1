function doGet(e) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("HCV");
    if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Sheet 'HCV' not found" }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const data = rows.slice(1).map(row => {
        let obj = {};
        headers.forEach((h, i) => {
            // Handle Date formatting
            if (row[i] instanceof Date) {
                obj[h] = Utilities.formatDate(row[i], Session.getScriptTimeZone(), "yyyy-MM-dd");
            } else {
                obj[h] = row[i];
            }
        });
        return obj;
    });

    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("HCV");
    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const payload = JSON.parse(e.postData.contents);
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

        if (payload.action === 'register') {
            const p = payload.data;

            // --- ROBUST MAPPING LOGIC START ---
            // This section matches headers to payload keys even if there are case/space differences
            const newRow = headers.map(h => {
                // 1. Try Exact Match
                if (p[h] !== undefined) return p[h];

                // 2. Try Trimmed Match (e.g. Header has spaces "Name " vs Key "Name")
                const hClean = String(h).trim();
                if (p[hClean] !== undefined) return p[hClean];

                // 3. Try Case-Insensitive Match (e.g. Header "physicien" vs Key "Physicien")
                const hLower = hClean.toLowerCase();
                for (const key in p) {
                    if (String(key).trim().toLowerCase() === hLower) {
                        return p[key];
                    }
                }

                // 4. Not Found
                return "";
            });
            // --- ROBUST MAPPING LOGIC END ---

            sheet.appendRow(newRow);
            return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
        }

        if (payload.action === 'update') {
            // Find row by ID (Pt file Num.)
            const id = payload.id;
            const updates = payload.updates;

            const data = sheet.getDataRange().getValues();

            // Robust ID Column Finder
            let idIndex = headers.indexOf("Pt file Num.");
            if (idIndex === -1) {
                // Try case insensitive find
                idIndex = headers.findIndex(h => h.trim() === "Pt file Num.");
            }

            if (idIndex === -1) throw new Error("ID Column 'Pt file Num.' not found");

            let rowIndex = -1;
            // Search for row
            for (let i = 1; i < data.length; i++) {
                if (String(data[i][idIndex]) === String(id)) {
                    rowIndex = i + 1;
                    break;
                }
            }

            if (rowIndex === -1) throw new Error("Patient not found");

            // Apply Updates
            for (const [key, value] of Object.entries(updates)) {
                let colIndex = headers.indexOf(key);

                // Robust Column Finder (Case Insensitive)
                if (colIndex === -1) {
                    colIndex = headers.findIndex(h => String(h).trim().toLowerCase() === String(key).trim().toLowerCase());
                }

                // Handle Dynamic Column Creation (Now allows ANY column like 'Place of death')
                if (colIndex === -1) {
                    if (key && key.length > 0) {
                        sheet.insertColumnAfter(sheet.getLastColumn());
                        const newColIndex = sheet.getLastColumn();
                        sheet.getRange(1, newColIndex).setValue(key); // Set Header
                        headers.push(key); // Update local headers array
                        colIndex = newColIndex - 1;
                    }
                }

                // Update Cell
                if (colIndex !== -1) {
                    sheet.getRange(rowIndex, colIndex + 1).setValue(value);
                }
            }

            return ContentService.createTextOutput(JSON.stringify({ status: "updated" })).setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService.createTextOutput(JSON.stringify({ error: "Invalid Action" })).setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
    } finally {
        lock.releaseLock();
    }
}
