// Harness: shims the three browser things the extracted decoder touches, then
// exercises it. The decoder source is spliced in verbatim from index.html by
// run-jstest.ps1 - this file never contains a copy of it.

var window = {};

function atob(s) {
  var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  s = s.replace(/=+$/, "");
  var out = "", bits = 0, acc = 0;
  for (var i = 0; i < s.length; i++) {
    var v = A.indexOf(s.charAt(i));
    if (v < 0) { throw new Error("bad char"); }
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 0xFF); }
  }
  return out;
}

function Uint8Array(n) { var a = []; for (var i = 0; i < n; i++) { a[i] = 0; } return a; }

/* ===== DECODER SOURCE SPLICED IN HERE ===== */
//<<<SPLICE>>>

/* ===== tests ===== */

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; WScript.Echo("  PASS  " + name); }
  else { fail++; WScript.Echo("  FAIL  " + name + (detail ? "  -- " + detail : "")); }
}

function bytesOf(b64) { var d = b64decode(b64); if (d.error) { throw new Error(d.error); } return d.bytes; }

WScript.Echo("=== self-test, as the page runs it on load ===");
var st = selfTest();
ok("golden vector: " + st.msg, st.ok);

WScript.Echo("");
WScript.Echo("=== real log 1 (1024 samples, no fault) ===");
var p1 = parseContainer(bytesOf(REAL_1), false);
ok("parses", p1.ok, p1.error);
if (p1.ok) {
  ok("CRC verified", p1.crcOk);
  ok("1024 samples", p1.values.length === 1024, "got " + p1.values.length);
  ok("first_index 20", p1.firstIndex === 20, "got " + p1.firstIndex);
  ok("interval 1 s", p1.intervalS === 1);
  ok("scheme 1", p1.scheme === 1);
  ok("no faults", p1.faults.length === 0, "got " + p1.faults.length);
  var lo = 9999, hi = -9999;
  for (var i = 0; i < p1.values.length; i++) {
    if (p1.values[i] < lo) { lo = p1.values[i]; }
    if (p1.values[i] > hi) { hi = p1.values[i]; }
  }
  ok("range 26.7 .. 27.2", lo === 267 && hi === 272, "got " + lo + ".." + hi);
  // rare-value fingerprint: absolute indices where 27.2 occurred
  var want272 = [565, 590, 707, 708, 723, 724, 729, 733, 734, 795, 797, 799];
  var got272 = [];
  for (i = 0; i < p1.values.length; i++) { if (p1.values[i] === 272) { got272.push(p1.firstIndex + i); } }
  ok("all twelve 27.2 positions", got272.join(",") === want272.join(","), got272.join(","));
  var got267 = [];
  for (i = 0; i < p1.values.length; i++) { if (p1.values[i] === 267) { got267.push(p1.firstIndex + i); } }
  ok("the single 26.7 at 929", got267.join(",") === "929", got267.join(","));
  // 199 = 16 header + 179 payload + 2 fault_count + 2 CRC. The fault_count field
  // is present even with zero faults - which is what the earlier hand arithmetic
  // in COMPRESSION-PLAN 12.5/12.6 missed.
  ok("payload 179 B", p1.size.payload === 179, "got " + p1.size.payload);
  ok("total 199 B", p1.size.total === 199, "got " + p1.size.total);
  ok("breakdown sums to the blob",
     p1.size.header + p1.size.payload + p1.size.faults + p1.size.crc === p1.size.total);
  var bits = p1.size.payload * 8 / p1.values.length;
  ok("1.40 bits/sample", bits.toFixed(2) === "1.40", bits.toFixed(2));
  ok("10.3x vs int16", (p1.values.length * 2 / p1.size.total).toFixed(1) === "10.3");
}

WScript.Echo("");
WScript.Echo("=== real log 2 (1024 samples, one fault) ===");
var p2 = parseContainer(bytesOf(REAL_2), false);
ok("parses", p2.ok, p2.error);
if (p2.ok) {
  ok("CRC verified", p2.crcOk);
  ok("1024 samples", p2.values.length === 1024);
  ok("first_index 3700", p2.firstIndex === 3700, "got " + p2.firstIndex);
  ok("exactly one fault", p2.faults.length === 1, "got " + p2.faults.length);
  ok("fault at absolute 4713", p2.firstIndex + p2.faults[0] === 4713,
     "got " + (p2.firstIndex + p2.faults[0]));
  ok("fault value is FAULT", p2.values[p2.faults[0]] === -2048);
  ok("neighbours intact 27.0 / 27.1",
     p2.values[p2.faults[0] - 1] === 270 && p2.values[p2.faults[0] + 1] === 271,
     p2.values[p2.faults[0] - 1] + " / " + p2.values[p2.faults[0] + 1]);
  ok("total 168 B", p2.size.total === 168, "got " + p2.size.total);
  ok("fault section 4 B", p2.size.faults === 4, "got " + p2.size.faults);
  var b2 = p2.size.payload * 8 / p2.values.length;
  ok("1.14 bits/sample", b2.toFixed(2) === "1.14", b2.toFixed(2));
  ok("12.2x vs int16", (p2.values.length * 2 / p2.size.total).toFixed(1) === "12.2");
  // NB: do not name these `esc` - that would shadow the page's esc() helper.
  var zero = p2.blockStats[13] || 0, escapes = p2.blockStats[14] || 0;
  ok("zero-blocks fired, no escapes", zero > 0 && escapes === 0, "zero=" + zero + " esc=" + escapes);
}

WScript.Echo("");
WScript.Echo("=== rejection cases ===");
function mutate(b64, idx, xor) {
  var b = bytesOf(b64), c = [];
  for (var i = 0; i < b.length; i++) { c[i] = b[i]; }
  c[idx] ^= xor;
  return c;
}
ok("flipped payload bit rejected", !parseContainer(mutate(REAL_2, 40, 0x10), false).ok);
ok("bad magic rejected", !parseContainer(mutate(REAL_2, 0, 0x20), false).ok);
var vr = parseContainer(mutate(REAL_2, 2, 0x03), false);
ok("wrong version rejected", !vr.ok, vr.error);
var runt = []; for (var q = 0; q < 10; q++) { runt[q] = 0; }
ok("runt blob rejected", !parseContainer(runt, false).ok);
var full = bytesOf(REAL_2), cut = [];
for (var z = 0; z < full.length - 40; z++) { cut[z] = full[z]; }
ok("truncated blob rejected when CRC enforced", !parseContainer(cut, false).ok);

WScript.Echo("");
WScript.Echo("=== degraded decode of a truncated payload ===");
var deg = parseContainer(cut, true);
ok("decodes something", deg.ok, deg.error);
if (deg.ok) {
  ok("flagged degraded", deg.degraded);
  ok("flagged truncated", deg.truncated);
  ok("header still says 1024", deg.count === 1024, "got " + deg.count);
  ok("fewer samples arrived", deg.values.length < 1024 && deg.values.length > 0,
     "got " + deg.values.length);
  var agree = true;
  for (var w = 0; w < deg.values.length; w++) { if (deg.values[w] !== p2.values[w]) { agree = false; break; } }
  ok("every surviving sample matches the intact decode", agree);
  WScript.Echo("        -> reports \"" + deg.values.length + " of " + deg.count + " arrived\"");
}

WScript.Echo("");
WScript.Echo("=== chart ===");
WScript.Echo("  typeof chartSVG=" + (typeof chartSVG) + " esc=" + (typeof esc) +
             " dur=" + (typeof dur) + " CH_L=" + CH_L);
try { WScript.Echo("  dur(3700)=" + dur(3700) + "  esc('a<b')=" + esc("a<b")); }
catch (e0) { WScript.Echo("  helper threw: " + e0.message); }
try { WScript.Echo("  tiny chart: " + String(chartSVG([260, 261, 260], 1, 0)).slice(0, 40)); }
catch (e1) { WScript.Echo("  tiny chart threw: " + e1.message); }
if (typeof chartSVG === "function") {
  var svg = chartSVG(p2.values, p2.intervalS, p2.firstIndex);
  ok("returns markup", !!svg && svg.indexOf("<svg") === 0);
  ok("has a trace path", svg.indexOf('class="line"') > 0);
  ok("marks the fault gap", svg.indexOf('class="gap"') > 0);
  var segs = svg.split("M").length - 1;
  ok("trace is broken at the fault (2 subpaths)", segs === 2, segs + " subpaths");
  var allFault = []; for (var f = 0; f < 20; f++) { allFault[f] = -2048; }
  ok("all-fault log yields no chart", chartSVG(allFault, 1, 0) === null);
  var flat = []; for (var g = 0; g < 50; g++) { flat[g] = 270; }
  var fsvg = chartSVG(flat, 1, 0);
  ok("flat log still renders", !!fsvg && fsvg.indexOf('class="line"') > 0);
  ok("flat log y-axis spans >= 1 C",
     fsvg.indexOf("26.5") > 0 || fsvg.indexOf("26.6") > 0, "min-span floor not applied");
}

WScript.Echo("");
WScript.Echo(fail === 0 ? ("ALL " + pass + " CHECKS PASSED") : (fail + " FAILED of " + (pass + fail)));
WScript.Quit(fail === 0 ? 0 : 1);
