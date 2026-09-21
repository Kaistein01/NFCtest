# Splices the decoder straight out of index.html into the harness and runs it
# under Windows' JScript engine. Nothing is transcribed: what is tested is the
# source that ships.
param(
  [string] $Page = (Join-Path $PSScriptRoot ".." | Join-Path -ChildPath "index.html"),
  [string] $Dir  = $PSScriptRoot,
  # The spliced file is a build artefact; keep it out of the repo.
  [string] $Work = $env:TEMP
)

$src = Get-Content $Page -Raw

function Slice([string]$text, [string]$from, [string]$to) {
  $a = $text.IndexOf($from)
  if ($a -lt 0) { throw "marker not found: $from" }
  $b = $text.IndexOf($to, $a + $from.Length)
  if ($b -lt 0) { throw "end marker not found: $to" }
  $text.Substring($a, $b - $a)
}

# S1..S6: helpers, base64, CRC, bit reader, container parser, golden vector.
$decoder = Slice $src "/* ===== S1" "/* ===== S7"
# S10: the chart, which is pure and therefore testable too.
$chart   = Slice $src "/* ===== S10" "/* ===== S9"

$spliced = $decoder + "`n" + $chart

$harness = Get-Content "$Dir\harness.js" -Raw
# A literal replace, not -replace: the regex engine would eat $ and \ in the code.
$out = $harness.Replace('//<<<SPLICE>>>', $spliced)

$outFile = Join-Path $Work "nfctest-jstest.js"
Set-Content -Path $outFile -Value $out -Encoding ascii
"spliced $($decoder.Length) + $($chart.Length) chars of real page source"

# The tests cover the decoder and the chart, which are pure. The render and
# event code is not exercised here, so at least prove it parses: a stray comma
# in renderRing would otherwise only show up on a phone. Everything between
# <script> and </script> goes into a function that is never called, so the
# engine parses it all and runs none of it.
$s = $src.IndexOf("<script>")
$e = $src.IndexOf("</script>", $s)
if ($s -lt 0 -or $e -lt 0) { throw "no <script> block found in $Page" }
$all = $src.Substring($s + 8, $e - $s - 8)
$parseFile = Join-Path $Work "nfctest-parse.js"
Set-Content -Path $parseFile -Encoding ascii -Value @"
function __never() {
$all
}
WScript.Echo("  PASS  whole page script parses ($($all.Length) chars)");
"@
& cscript //nologo $parseFile
if ($LASTEXITCODE -ne 0) { "  FAIL  the page script does not parse"; exit 1 }
""
& cscript //nologo $outFile
exit $LASTEXITCODE
