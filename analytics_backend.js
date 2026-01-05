function handleGetAnalyticsData() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var historySheet = ss.getSheetByName('History_Log');

    if (!historySheet) {
        return { status: 'success', dates: [], census: [], symptoms: {} };
    }

    var data = historySheet.getDataRange().getValues();
    if (data.length < 2) return { status: 'success', dates: [], census: [], symptoms: {} };

    var headers = data[0];
    var dateIdx = 0; // 'Date' is usually first
    var symptomsIdx = headers.indexOf('Symptoms'); // Case sensitive? Based on handleDailyReset it is 'Symptoms' or 'symptoms'
    if (symptomsIdx === -1) symptomsIdx = headers.indexOf('symptoms');

    // Aggregation Map: DateString -> { count: 0, symptoms: { Pain: 0, ... } }
    var dailyStats = {};

    for (var i = 1; i < data.length; i++) {
        var rawDate = data[i][dateIdx];
        if (!rawDate) continue;

        // Format Date YYYY-MM-DD
        var dateObj = new Date(rawDate);
        var dateStr = dateObj.toISOString().split('T')[0];

        if (!dailyStats[dateStr]) {
            dailyStats[dateStr] = { count: 0, symptoms: {} };
        }

        dailyStats[dateStr].count++;

        // Parse Symptoms
        var symString = data[i][symptomsIdx];
        if (symString) {
            try {
                var symJson = (typeof symString === 'string') ? JSON.parse(symString) : symString;
                Object.keys(symJson).forEach(function (k) {
                    // Check if symptom present (value > 0 or true)
                    if (symJson[k]) {
                        if (!dailyStats[dateStr].symptoms[k]) dailyStats[dateStr].symptoms[k] = 0;
                        dailyStats[dateStr].symptoms[k]++;
                    }
                });
            } catch (e) {
                // Ignore parse errors
            }
        }
    }

    // Convert to Arrays sorted by Date
    var sortedDates = Object.keys(dailyStats).sort();
    // Limit to last 30 days to keep payload small
    if (sortedDates.length > 30) {
        sortedDates = sortedDates.slice(sortedDates.length - 30);
    }

    var censusArr = [];
    var symptomAgg = {};

    sortedDates.forEach(function (d) {
        censusArr.push(dailyStats[d].count);
        var daySyms = dailyStats[d].symptoms;
        Object.keys(daySyms).forEach(function (s) {
            if (!symptomAgg[s]) symptomAgg[s] = new Array(sortedDates.length).fill(0);
        });
    });

    // Fill symptom arrays
    sortedDates.forEach(function (d, idx) {
        var daySyms = dailyStats[d].symptoms;
        Object.keys(symptomAgg).forEach(function (s) {
            if (daySyms[s]) symptomAgg[s][idx] = daySyms[s];
        });
    });

    return {
        status: 'success',
        dates: sortedDates,
        census: censusArr,
        symptoms: symptomAgg
    };
}
