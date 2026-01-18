
$file = "C:\Users\palliative\.gemini\antigravity\scratch\p1-main\js\main.js"
$content = Get-Content -Path $file -Raw

# Replace backslash-backtick with just backtick
# In PS: backtick is escape char (`). So literal ` is ``.
# To match string literal "\`" we need "\``".
# To replace with "`" we need "``".
$fixed = $content.Replace("\``", "``")

if ($fixed -ne $content) {
    Set-Content -Path $file -Value $fixed -Encoding UTF8
    Write-Host "Fixed escaped backticks."
}
else {
    Write-Host "No escaped backticks found."
}
