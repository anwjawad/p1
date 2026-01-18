
$file = "C:\Users\palliative\.gemini\antigravity\scratch\p1-main\js\main.js"
$content = Get-Content -Path $file -Raw

$search = @"
        } else {
            const firstWard = wardKeys[0];
            if (firstWard) selectWard(firstWard);
        }
"@

$replace = @"
        } else {
            // Find first ward with patients
            const populatedWard = wardKeys.find(key => appData.wards[key] && appData.wards[key].length > 0);
            const target = populatedWard || wardKeys[0];
            if (target) selectWard(target);
        }
"@

# Normalize formatting to ensure match (remove potential windows/unix mismatch)
$contentFixed = $content.Replace("`r`n", "`n").Replace($search.Replace("`r`n", "`n"), $replace.Replace("`r`n", "`n"))

if ($contentFixed -eq $content) {
    Write-Host "No replacement made. Trying fuzzy match..."
    # Fallback: Just replace the inner 2 lines if full block fails
    $searchSmall = @"
            const firstWard = wardKeys[0];
            if (firstWard) selectWard(firstWard);
"@
    $replaceSmall = @"
            // Find first ward with patients
            const populatedWard = wardKeys.find(key => appData.wards[key] && appData.wards[key].length > 0);
            const target = populatedWard || wardKeys[0];
            if (target) selectWard(target);
"@
      $contentFixed = $content.Replace("`r`n", "`n").Replace($searchSmall.Replace("`r`n", "`n"), $replaceSmall.Replace("`r`n", "`n"))
}

# Write back with original line endings (or just UTF8)
Set-Content -Path $file -Value $contentFixed -Encoding UTF8
Write-Host "Done."
