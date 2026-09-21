# Runs the page's tests under Windows' JScript engine. Nothing is transcribed:
# the pure sections S1-S9 are spliced straight out of index.html, and the demo
# URL straight out of demo/demo-url.txt, so what is tested is what ships.
param(
  [string] $Root = (Join-Path $PSScriptRoot ".."),
  [string] $Dir  = $PSScriptRoot,
  # The spliced files are build artefacts; keep them out of the repo.
  [string] $Work = $env:TEMP
)

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Slice([string]$text, [string]$from, [string]$to) {
  $a = $text.IndexOf($from)
  if ($a -lt 0) { throw "marker not found: $from" }
  $b = $text.IndexOf($to, $a + $from.Length)
  if ($b -lt 0) { throw "end marker not found: $to" }
  $text.Substring($a, $b - $a)
}

# 1. Publishing (LIBERO-LITE-PLAN L18): the company name must not appear in any
#    file of this public repository. The word is built from two halves so this
#    script does not find itself.
$word = 'el' + 'pro'
$hits = @(Get-ChildItem -Path $Root -Recurse -File -Force |
  Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' } |
  Select-String -Pattern $word -SimpleMatch -List)
if ($hits.Count) {
  "  FAIL  the company name appears in:"
  $hits | ForEach-Object { "        $($_.Path):$($_.LineNumber)" }
  exit 1
}
"  PASS  no company name in any file of the repository"

# 2. The page and the demo URL. Read as UTF-8: the page holds non-ASCII text.
$src = [IO.File]::ReadAllText((Join-Path $Root "index.html"), $utf8)
$pure = Slice $src "/* ===== S1 " "/* ===== S10 "

$demoUrl = [IO.File]::ReadAllText((Join-Path $Root "demo\demo-url.txt"), $utf8).Trim()
if ($demoUrl -notmatch '^https://[A-Za-z0-9./?=&_#-]+$') { throw "demo-url.txt is not a plain URL" }

$harness = [IO.File]::ReadAllText((Join-Path $Dir "harness.js"), $utf8)
# Literal replaces, not -replace: the regex engine would eat $ and \ in the code.
$out = $harness.Replace('//<<<SPLICE>>>', $pure).Replace('//<<<DEMO>>>', 'var DEMO_URL = "' + $demoUrl + '";')

# UTF-16 with a BOM is the one encoding JScript reads exactly, so the page's
# dashes and degree signs compare equal to the harness's.
$outFile = Join-Path $Work "nfctest-jstest.js"
[IO.File]::WriteAllText($outFile, $out, [Text.Encoding]::Unicode)
"  spliced $($pure.Length) chars of page source and a $($demoUrl.Length)-char demo URL"

# 3. The render and event code is not exercised here, so at least prove the
#    whole script parses under ES3: everything between <script> and </script>
#    goes into a function that is never called.
$s = $src.IndexOf("<script>")
$e = $src.IndexOf("</script>", $s)
if ($s -lt 0 -or $e -lt 0) { throw "no <script> block found" }
$all = $src.Substring($s + 8, $e - $s - 8)
$parseFile = Join-Path $Work "nfctest-parse.js"
[IO.File]::WriteAllText($parseFile,
  "function __never() {`n$all`n}`nWScript.Echo(`"  PASS  whole page script parses ($($all.Length) chars)`");",
  [Text.Encoding]::Unicode)
& cscript //nologo $parseFile
if ($LASTEXITCODE -ne 0) { "  FAIL  the page script does not parse"; exit 1 }

& cscript //nologo $outFile
exit $LASTEXITCODE
