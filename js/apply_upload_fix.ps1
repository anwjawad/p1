
$target = "C:\Users\palliative\.gemini\antigravity\scratch\p1-main\js\main.js"
$source = "C:\Users\palliative\.gemini\antigravity\scratch\p1-main\js\fix_upload_logic.js"

$mainContent = Get-Content -Path $target -Raw
$newLogic = Get-Content -Path $source -Raw

# 1. Remove old handleLabsImageUpload if exists
# Regex to match the entire function block roughly
$pattern = "(?s)function handleLabsImageUpload\(file\) \{.*?\n\}"
$cleanContent = $mainContent -replace $pattern, ""

# 2. Append new logic to end of file
$finalContent = $cleanContent + "`n`n" + $newLogic

# 3. Write back
Set-Content -Path $target -Value $finalContent -Encoding UTF8
Write-Host "Injected new upload logic."
