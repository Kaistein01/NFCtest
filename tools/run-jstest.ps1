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
""
& cscript //nologo $outFile
exit $LASTEXITCODE
