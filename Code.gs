/**
 * Palliative Care Rounds - Robust Backend V3 (AI Command Center)
 */

// --- Configuration ---
const SHEET_NAME = 'Patients';
const LOCK_WAIT_MS = 10000;
const GEMINI_API_KEY = 'AIzaSyDyxZSczhZoJ7OnIJxwV053VnFSzG2j6MY'; 

function doGet(e) {
  const lock = LockService.getScriptLock();
  if (lock.tryLock(LOCK_WAIT_MS)) {
    try {
      const data = getAllPatients();
      return jsonResponse(data);
    } catch (err) {
      return jsonResponse({ error: err.toString() });
    } finally {
      lock.releaseLock();
    }
  } else {
    return jsonResponse({ error: "Server busy, please try again." });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  
  if (lock.tryLock(LOCK_WAIT_MS)) {
    try {
      if (!e.postData || !e.postData.contents) {
        throw new Error("No data received");
      }
      const data = JSON.parse(e.postData.contents);
      const action = data.action || 'update'; 

      let result;
      // --- ROUTING ---
      switch (action) {
        case 'import':
          result = handleImport(data.patients);
          break;
        case 'batch_update':
          result = handleBatchUpdate(data.updates);
          break;
        // AI Actions
        case 'generate_plan':
           result = handleGenerateDischargePlan(data.medications);
           break;
        case 'generate_summary':
           result = handleGenerateSummary(data.patient);
           break;
        case 'generate_suggestions':
           result = handleGenerateSuggestions(data.patient);
           break;
        default:
          // Single Update
          result = handleSingleUpdate(data);
      }
      
      return jsonResponse(result);
      
    } catch (err) {
      return jsonResponse({ error: err.toString(), stack: err.stack });
    } finally {
      lock.releaseLock();
    }
  } else {
    return jsonResponse({ error: "Server busy (Lock Timeout), please try again." });
  }
}

// --- AI Handlers ---

function callGemini(prompt) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }]
    };

    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(payload)
    };

    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    return json.candidates[0].content.parts[0].text;

  } catch (e) {
    throw new Error('AI Generation Failed: ' + e.toString());
  }
}

function handleGenerateDischargePlan(medicationsText) {
  if (!medicationsText) return { status: 'error', message: 'No medications provided' };

  const prompt = `
    You are a medical assistant for palliative care. 
    Analyze the following list of medications and categorize them into a JSON object with these exact keys:
    - analgesics (for pain, e.g., opioids, paracetamol, NSAIDs, Optalgin)
    - antiemetics (for nausea/vomiting, e.g., Pramin, Zofran)
    - anxiolytics (for anxiety/agitation, e.g., Benzos, Midolam)
    - sleep (for insomnia, e.g., Nocturno, Bondormin)
    - anticoagulants (blood thinners, e.g., Clexane, Eliquis)
    - others (any other medication)

    Return ONLY the raw JSON object. No markdown, no "json" prefix.
    
    Medications:
    ${medicationsText}
  `;

  try {
    let aiText = callGemini(prompt);
    // Cleanup
    aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
    const categorized = JSON.parse(aiText);
    return { status: 'success', data: categorized };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleGenerateSummary(patient) {
  if (!patient) return { status: 'error', message: 'No patient data' };
  
  // Construct patient context
  const context = `
    Name: ${patient.name}
    Age: ${patient.age}
    Diagnosis: ${patient.diagnosis}
    Room: ${patient.room}
    Ward: ${patient.ward}
    Current Symptoms: ${JSON.stringify(patient.symptoms || {})}
    Labs: ${JSON.stringify(patient.labs || {})}
    Medications: ${patient.medications}
    Notes: ${patient.notes}
  `;

  const prompt = `
    You are a compassionate palliative care consultant.
    Please write a professional, concise daily clinical summary for this patient.
    Focus on:
    1. Primary diagnosis and current status.
    2. Key symptom burden (highlight severe symptoms).
    3. Notable medication changes or high-alert meds (opioids).
    4. Provide a brief "One-Liner" at the top.
    
    Format nicely with Markdown (bolding key terms).
    
    Patient Data:
    ${context}
  `;

  try {
    const summary = callGemini(prompt);
    return { status: 'success', data: summary };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleGenerateSuggestions(patient) {
  if (!patient) return { status: 'error', message: 'No patient data' };
  
  const context = `
    Name: ${patient.name}
    Diagnosis: ${patient.diagnosis}
    Symptoms: ${JSON.stringify(patient.symptoms || {})}
    Labs: ${JSON.stringify(patient.labs || {})}
    Current Meds: ${patient.medications}
  `;

  const prompt = `
    You are an expert palliative care AI assistant.
    Based on this patient's data, suggest 3-5 specific care implementations or medication adjustments.
    Consider:
    - Uncontrolled symptoms (e.g., if pain is high, suggest titration or adjuvants).
    - Potential side effects (e.g., if on opioids, ensure laxatives are prescribed).
    - Lab abnormalities (e.g., hypercalcemia, hyponatremia).
    
    Be concise and actionable. Use bullet points.
    
    Patient Data:
    ${context}
  `;

  try {
    const suggestions = callGemini(prompt);
    return { status: 'success', data: suggestions };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


// --- Standard Handlers (No Changes) ---
function handleImport(patients) {
  if (!patients || !Array.isArray(patients) || patients.length === 0) {
    return { status: 'success', count: 0, message: 'Nothing to import' };
  }
  
  const sheet = getWorkingSheet();
  const headers = ensureHeaders(sheet);
  
  const rows = patients.map(p => {
    return headers.map(h => {
      let val = p[h];
      if (typeof val === 'object' && val !== null) {
        val = JSON.stringify(val);
      }
      return val || '';
    });
  });
  
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { status: 'success', count: rows.length };
}

function handleBatchUpdate(updates) {
  const sheet = getWorkingSheet();
  const headers = ensureHeaders(sheet);
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  const idColIdx = headers.indexOf('id');
  if (idColIdx === -1) throw new Error("ID column missing in Sheet");
  const rowMap = new Map();
  for (let i = 1; i < values.length; i++) {
    const id = values[i][idColIdx];
    if (id) rowMap.set(String(id), i);
  }
  
  let changed = false;
  Object.keys(updates).forEach(id => {
    if (rowMap.has(id)) {
      const rowIndex = rowMap.get(id);
      const changes = updates[id];
      
      Object.keys(changes).forEach(field => {
        let colIdx = headers.indexOf(field);
        if (colIdx > -1) {
          let val = changes[field];
          if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
          
          if (values[rowIndex][colIdx] != val) {
             values[rowIndex][colIdx] = val;
             changed = true;
          }
        }
      });
    }
  });
  
  if (changed) {
    dataRange.setValues(values);
  }
  
  return { status: 'success', changed: changed };
}

function handleSingleUpdate(p) {
  if (!p.id) throw new Error("Patient ID required");
  
  const sheet = getWorkingSheet();
  const headers = ensureHeaders(sheet);
  
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const idColIdx = headers.indexOf('id');
  
  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idColIdx]) === String(p.id)) {
      rowIndex = i;
      break;
    }
  }
  
  const newRow = headers.map(h => {
    let oldVal = (rowIndex > -1) ? values[rowIndex][headers.indexOf(h)] : '';
    let newVal = p[h];
    
    if (newVal === undefined) return oldVal; 
    
    if (typeof newVal === 'object' && newVal !== null) return JSON.stringify(newVal);
    return newVal;
  });
  
  if (rowIndex > -1) {
    sheet.getRange(rowIndex + 1, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }
  
  return { status: 'success', id: p.id };
}

function getAllPatients() {
  const sheet = getWorkingSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const output = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, idx) => {
      let val = row[idx];
      if (h === 'labs' || h === 'symptoms' || h === 'history_labs' || h === 'history_symptoms' || (typeof val === 'string' && val.startsWith('{'))) {
        try {
          val = JSON.parse(val);
        } catch (e) { }
      }
      obj[h] = val;
    });
    output.push(obj);
  }
  return output;
}

// --- Helpers ---
function getWorkingSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    ensureHeaders(sheet);
  }
  return sheet;
}

function ensureHeaders(sheet) {
  const required = [
    'id', 'name', 'code', 'ward', 'room', 'age', 
    'diagnosis', 'provider', 'treatment', 'medications', 
    'notes', 'symptoms', 'labs', 'history_symptoms', 'history_labs', 'last_updated'
  ];
  
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(required);
    return required;
  }
  
  const range = sheet.getRange(1, 1, 1, lastCol);
  const currentHeaders = range.getValues()[0];
  
  const missing = required.filter(h => !currentHeaders.includes(h));
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    return [...currentHeaders, ...missing];
  }
  
  return currentHeaders;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
