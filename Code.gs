/**
 * Palliative Care Rounds - Robust Backend V5 (Syntax Fix)
 */

var SHEET_NAME = 'Patients';
var METADATA_SHEET_NAME = 'Metadata'; // New Sheet for Settings/Sections
var LOCK_WAIT_MS = 10000;
var GEMINI_API_KEY = 'AIzaSyDyxZSczhZoJ7OnIJxwV053VnFSzG2j6MY'; 

// --- CORS Config ---
function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

// --- Auth Helper ---
function forceAuth() {
  UrlFetchApp.fetch("https://www.google.com");
  console.log("Auth Successful!");
}

function testConnection() {
  console.log("Testing Gemini Connection...");
  try {
    var result = callGemini("Say hello");
    console.log("Success: " + result);
  } catch (e) {
    console.error("Error: " + e.toString());
  }
}

// --- Main Handlers ---

function doGet(e) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(LOCK_WAIT_MS)) {
    try {
      var data = getAllPatients();
      var metadata = getMetadata(); // Fetch options/sections too
      return corsJsonResponse({ patients: data, metadata: metadata });
    } catch (err) {
      return corsJsonResponse({ error: err.toString() });
    } finally {
      lock.releaseLock();
    }
  } else {
    return corsJsonResponse({ error: "Server busy, please try again." });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  
  if (lock.tryLock(LOCK_WAIT_MS)) {
    try {
      if (!e.postData || !e.postData.contents) {
        throw new Error("No data received");
      }
      var data = JSON.parse(e.postData.contents);
      var action = data.action || 'update'; 

      var result;
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
        case 'reset_day':
           result = handleDailyReset();
           break;
        case 'get_files':
           result = handleGetDriveFiles(data.folderId);
           break;
        case 'save_metadata':
           result = handleSaveMetadata(data.metadata);
           break;
        default:
          // Single Update
          result = handleSingleUpdate(data);
      }
      
      return corsJsonResponse(result);
      
    } catch (err) {
      return corsJsonResponse({ error: err.toString(), stack: err.stack });
    } finally {
      lock.releaseLock();
    }
  } else {
    return corsJsonResponse({ error: "Server busy (Lock Timeout), please try again." });
  }
}

// --- AI Handlers ---

function callGemini(prompt) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;
  var payload = {
    contents: [{
      parts: [{ text: prompt }]
    }]
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code === 429) {
     throw new Error("AI is busy (Rate Limit). Please wait a minute and try again.");
  }
  
  if (code !== 200) {
     throw new Error("AI Error (" + code + "): " + text);
  }

  try {
    var json = JSON.parse(text);
    if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
       throw new Error("AI returned no content. Please try again.");
    }
    return json.candidates[0].content.parts[0].text;
  } catch (e) {
    throw new Error("Failed to parse AI response: " + e.message);
  }
}

function handleGenerateDischargePlan(medicationsText) {
  if (!medicationsText) return { status: 'error', message: 'No medications provided' };

  var prompt = 
    "You are a medical assistant for palliative care.\n" +
    "Analyze the following list of medications and categorize them into a JSON object with these exact keys:\n" +
    "- analgesics (for pain, e.g., opioids, paracetamol, NSAIDs, Optalgin)\n" +
    "- antiemetics (for nausea/vomiting, e.g., Pramin, Zofran)\n" +
    "- anxiolytics (for anxiety/agitation, e.g., Benzos, Midolam)\n" +
    "- sleep (for insomnia, e.g., Nocturno, Bondormin)\n" +
    "- anticoagulants (blood thinners, e.g., Clexane, Eliquis)\n" +
    "- others (any other medication)\n\n" +
    "Return ONLY the raw JSON object. No markdown, no 'json' prefix.\n\n" +
    "Medications:\n" + medicationsText;

  try {
    var aiText = callGemini(prompt);
    // Cleanup
    aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
    var categorized = JSON.parse(aiText);
    return { status: 'success', data: categorized };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleGenerateSummary(patient) {
  if (!patient) return { status: 'error', message: 'No patient data' };
  
  // Construct patient context
  var context = 
    "Name: " + patient.name + "\n" +
    "Age: " + patient.age + "\n" +
    "Diagnosis: " + patient.diagnosis + "\n" +
    "Room: " + patient.room + "\n" +
    "Ward: " + patient.ward + "\n" +
    "Current Symptoms: " + JSON.stringify(patient.symptoms || {}) + "\n" +
    "Labs: " + JSON.stringify(patient.labs || {}) + "\n" +
    "Medications: " + patient.medications + "\n" +
    "Notes: " + patient.notes;

  var prompt = 
    "You are a compassionate palliative care consultant.\n" +
    "Please write a professional, concise daily clinical summary for this patient.\n" +
    "Focus on:\n" +
    "1. Primary diagnosis and current status.\n" +
    "2. Key symptom burden (highlight severe symptoms).\n" +
    "3. Notable medication changes or high-alert meds (opioids).\n" +
    "4. Provide a brief 'One-Liner' at the top.\n\n" +
    "Format nicely with Markdown (bolding key terms).\n\n" +
    "Patient Data:\n" + context;

  try {
    var summary = callGemini(prompt);
    return { status: 'success', data: summary };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleGenerateSuggestions(patient) {
  if (!patient) return { status: 'error', message: 'No patient data' };
  
  var context = 
    "Name: " + patient.name + "\n" +
    "Diagnosis: " + patient.diagnosis + "\n" +
    "Symptoms: " + JSON.stringify(patient.symptoms || {}) + "\n" +
    "Labs: " + JSON.stringify(patient.labs || {}) + "\n" +
    "Current Meds: " + patient.medications;

  var prompt = 
    "You are an expert palliative care AI assistant.\n" +
    "Based on this patient's data, suggest 3-5 specific care implementations or medication adjustments.\n" +
    "Consider:\n" +
    "- Uncontrolled symptoms (e.g., if pain is high, suggest titration or adjuvants).\n" +
    "- Potential side effects (e.g., if on opioids, ensure laxatives are prescribed).\n" +
    "- Lab abnormalities (e.g., hypercalcemia, hyponatremia).\n\n" +
    "Be concise and actionable. Use bullet points.\n\n" +
    "Patient Data:\n" + context;

  try {
    var suggestions = callGemini(prompt);
    return { status: 'success', data: suggestions };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function handleDailyReset() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getWorkingSheet();
  var historySheet = ss.getSheetByName('History_Log');
  if (!historySheet) {
    historySheet = ss.insertSheet('History_Log');
    historySheet.appendRow(['Date', 'Patient Name', 'ID', 'Diagnosis', 'Notes', 'Medications', 'Symptoms', 'Labs']);
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var symptomsIdx = headers.indexOf('symptoms');
  var labsIdx = headers.indexOf('labs');
  
  // Archive
  var timestamp = new Date();
  var archiveData = [];
  
  // Skip header, start at row 1
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Map to History Columns: Date, Name, ID, Diagnosis, Notes, Meds, Symptoms, Labs
    archiveData.push([
      timestamp,
      row[headers.indexOf('name')],
      row[headers.indexOf('id')],
      row[headers.indexOf('diagnosis')],
      row[headers.indexOf('notes')],
      row[headers.indexOf('medications')],
      row[headers.indexOf('symptoms')],
      row[headers.indexOf('labs')]
    ]);
    
    // Reset Logic in memory
    if (symptomsIdx > -1) row[symptomsIdx] = '';
    if (labsIdx > -1) row[labsIdx] = '';
  }
  
  // Write Archive
  if (archiveData.length > 0) {
    historySheet.getRange(historySheet.getLastRow() + 1, 1, archiveData.length, archiveData[0].length).setValues(archiveData);
  }
  
  // Updates Main Sheet (FULL WIPE)
  // User requested to clear everything (Patients, Meds, etc) to start fresh.
  if (data.length > 1) {
     // Clear everything from Row 2 downwards
     sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  
  return { status: 'success', archived_count: archiveData.length };
}

function handleGetDriveFiles(folderId) {
  if (!folderId) return { status: 'error', message: 'No Folder ID provided' };
  
  try {
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFiles();
    var fileList = [];
    
    while (files.hasNext()) {
      var file = files.next();
      fileList.push({
        name: file.getName(),
        url: file.getUrl(),
        mimeType: file.getMimeType(),
        size: file.getSize(), 
        lastUpdated: file.getLastUpdated()
      });
    }
    
    return { status: 'success', files: fileList };
  } catch (e) {
    return { status: 'error', message: "Drive Error: " + e.message };
  }
}

// --- Metadata Handlers ---

function getMetadata() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(METADATA_SHEET_NAME);
  if (!sheet) return {}; 
  
  var data = sheet.getDataRange().getValues();
  // Simple Key-Value Store implementation
  // Row 1 = Key, Row 2 = Value (JSON encoded)
  var output = {};
  if (data.length < 2) return {};
  
  var keys = data[0];
  var values = data[1];
  
  keys.forEach(function(k, i) {
    if (k && values[i]) {
       try {
         output[k] = JSON.parse(values[i]);
       } catch (e) {
         output[k] = values[i];
       }
    }
  });
  
  return output;
}

function handleSaveMetadata(newMeta) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(METADATA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(METADATA_SHEET_NAME);
  }
  
  // Get existing
  var existing = getMetadata();
  var merged = Object.assign({}, existing, newMeta);
  
  // Write back (Simple: overwrite row 1 & 2)
  var keys = Object.keys(merged);
  var values = keys.map(function(k) { 
     var v = merged[k];
     return (typeof v === 'object') ? JSON.stringify(v) : v;
  });
  
  sheet.clear();
  if (keys.length > 0) {
    sheet.getRange(1, 1, 1, keys.length).setValues([keys]);
    sheet.getRange(2, 1, 1, values.length).setValues([values]);
  }
  
  return { status: 'success' };
}



// --- Standard Handlers (No Changes) ---
function handleImport(patients) {
  if (!patients || !Array.isArray(patients) || patients.length === 0) {
    return { status: 'success', count: 0, message: 'Nothing to import' };
  }
  
  var sheet = getWorkingSheet();
  var headers = ensureHeaders(sheet);
  
  var rows = patients.map(function(p) {
    return headers.map(function(h) {
      var val = p[h];
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
  var sheet = getWorkingSheet();
  var headers = ensureHeaders(sheet);
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  
  var idColIdx = headers.indexOf('id');
  if (idColIdx === -1) throw new Error("ID column missing in Sheet");
  var rowMap = new Map();
  for (var i = 1; i < values.length; i++) {
    var id = values[i][idColIdx];
    if (id) rowMap.set(String(id), i);
  }
  
  var changed = false;
  Object.keys(updates).forEach(function(id) {
    if (rowMap.has(id)) {
      var rowIndex = rowMap.get(id);
      var changes = updates[id];
      
      Object.keys(changes).forEach(function(field) {
        var colIdx = headers.indexOf(field);
        if (colIdx > -1) {
          var val = changes[field];
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
  
  var sheet = getWorkingSheet();
  var headers = ensureHeaders(sheet);
  
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var idColIdx = headers.indexOf('id');
  
  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idColIdx]) === String(p.id)) {
      rowIndex = i;
      break;
    }
  }
  
  var newRow = headers.map(function(h) {
    var oldVal = (rowIndex > -1) ? values[rowIndex][headers.indexOf(h)] : '';
    var newVal = p[h];
    
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
  var sheet = getWorkingSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var output = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    headers.forEach(function(h, idx) {
      var val = row[idx];
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    ensureHeaders(sheet);
  }
  return sheet;
}

function ensureHeaders(sheet) {
  var required = [
    'id', 'name', 'code', 'ward', 'room', 'age', 
    'diagnosis', 'provider', 'treatment', 'medications', 
    'notes', 'symptoms', 'labs', 'history_symptoms', 
    'history_labs', 'last_updated', 'plan', 'is_highlighted'
  ];
  
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(required);
    return required;
  }
  
  var range = sheet.getRange(1, 1, 1, lastCol);
  var currentHeaders = range.getValues()[0];
  
  var missing = required.filter(function(h) { return !currentHeaders.includes(h); });
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    return [...currentHeaders, ...missing];
  }
  
  return currentHeaders;
}

function corsJsonResponse(data) {
  var output = JSON.stringify(data);
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}
