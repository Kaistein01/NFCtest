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

/* ===== v2, the cyclic ring =====
   The page has no encoder, so the rings below are built here out of the one
   real segment the firmware produced: copy it, change its header, fix its CRC.
   That is enough to exercise ordering, gaps, damage and overflow without
   inventing a second implementation of the format. */

WScript.Echo("");
WScript.Echo("=== v2 reference vector ===");
var v2bytes = bytesOf(GOLDEN_V2);
var pr = parseRing(v2bytes);
ok("parses", pr.ok, pr.error);
if (pr.ok) {
  ok("70 samples", pr.values.length === 70, "got " + pr.values.length);
  ok("interval 10 s", pr.intervalS === 10);
  ok("geometry 357 x 17", pr.segBytes === 357 && pr.segTotal === 17,
     pr.segBytes + " x " + pr.segTotal);
  ok("one segment, readable", pr.segOk === 1 && pr.segDamaged === 0);
  ok("not wrapped", pr.wrapped === false);
  ok("nothing overwritten", pr.overwritten === 0);
  ok("newest is #69", pr.newest === 69, "got " + pr.newest);
  ok("two faults at 42 and 47", pr.faults.join(",") === "42,47", pr.faults.join(","));

  var pv1 = parseContainer(bytesOf(GOLDEN_B64), false);
  var same = pv1.ok && pv1.values.length === pr.values.length;
  for (var z = 0; same && z < pv1.values.length; z++) {
    if (pv1.values[z] !== pr.values[z]) { same = false; }
  }
  ok("decodes to exactly the same samples as the v1 vector", same);
}

/* ---- builders ---- */
function sliceArr(a, off, len) {
  var out = [], i;
  for (i = 0; i < len; i++) { out.push(a[off + i]); }
  return out;
}
function put32(a, o, v) {
  a[o] = v & 0xFF; a[o + 1] = (v >> 8) & 0xFF;
  a[o + 2] = (v >> 16) & 0xFF; a[o + 3] = (v >>> 24) & 0xFF;
}
function fixSegCrc(seg) {
  var c = crc16Range(seg, 0, seg.length, 7);
  seg[7] = c & 0xFF; seg[8] = (c >> 8) & 0xFF;
}
/* A copy of the reference segment, restamped to start at `first`. */
function segAt(first, count) {
  var s = sliceArr(v2bytes, V2_GLOBAL, 357);
  put32(s, 0, first);
  if (count !== undefined) { s[4] = count & 0xFF; s[5] = (count >> 8) & 0xFF; }
  fixSegCrc(s);
  return s;
}
function buildRing(segs, openSeg, wrapped) {
  var g = sliceArr(v2bytes, 0, V2_GLOBAL), i, j, c;
  g[9] = openSeg; g[10] = wrapped ? 1 : 0;
  c = crc16Range(g, 0, 16, -1);
  g[16] = c & 0xFF; g[17] = (c >> 8) & 0xFF;
  for (i = 0; i < segs.length; i++) {
    for (j = 0; j < segs[i].length; j++) { g.push(segs[i][j]); }
  }
  return g;
}

WScript.Echo("");
WScript.Echo("=== v2 ring, constructed cases ===");

var two = parseRing(buildRing([segAt(0), segAt(70)], 1, false));
ok("two segments: 140 samples", two.ok && two.values.length === 140,
   two.ok ? "got " + two.values.length : two.error);
ok("two segments: indices run 0..139",
   two.ok && two.indices[0] === 0 && two.indices[139] === 139);
ok("two segments: no gaps", two.ok && two.gaps === 0);

/* Slot order is not time order: the ring writes round and round. */
var rev = parseRing(buildRing([segAt(70), segAt(0)], 0, true));
ok("out-of-order slots are sorted by first sample index",
   rev.ok && rev.indices[0] === 0 && rev.indices[139] === 139, rev.error);
ok("wrapped flag is read", rev.ok && rev.wrapped === true);

/* A hole between segments must show, not close up silently. */
var gap = parseRing(buildRing([segAt(0), segAt(100)], 1, false));
ok("gap: counted", gap.ok && gap.gaps === 1, gap.ok ? "gaps=" + gap.gaps : gap.error);
ok("gap: 30 samples reported missing", gap.ok && gap.missing === 30,
   gap.ok ? "missing=" + gap.missing : "");
ok("gap: both sides still decode", gap.ok && gap.values.length === 140);

/* Damage is contained: one bad segment costs only itself. */
var bad = segAt(70); bad[40] ^= 0xFF;          // corrupt payload, leave CRC stale
var dmg = parseRing(buildRing([segAt(0), bad], 1, false));
ok("damaged segment: skipped", dmg.ok && dmg.segDamaged === 1, dmg.error);
ok("damaged segment: the good one survives", dmg.ok && dmg.values.length === 70);
ok("damaged segment: 70 samples still charted", dmg.ok && dmg.indices[0] === 0);

var allBad = segAt(0); allBad[40] ^= 0xFF;
var none = parseRing(buildRing([allBad], 0, false));
ok("every segment damaged is an error", !none.ok && /no readable segment/.test(none.error),
   none.error);

/* A segment that has never been written carries count 0. */
var emptySeg = segAt(0, 0);
var emp = parseRing(buildRing([segAt(0), emptySeg], 0, false));
ok("empty segment counted and skipped", emp.ok && emp.segEmpty === 1 && emp.values.length === 70,
   emp.error);

/* Overflow is derived from the oldest surviving index, not guessed. */
var ovr = parseRing(buildRing([segAt(500), segAt(570)], 1, true));
ok("overflow: 500 samples reported overwritten", ovr.ok && ovr.overwritten === 500,
   ovr.ok ? "got " + ovr.overwritten : ovr.error);
ok("overflow: newest is #639", ovr.ok && ovr.newest === 639, ovr.ok ? "got " + ovr.newest : "");

/* A fragment cut mid-segment keeps every whole segment before the cut. */
var cut = buildRing([segAt(0), segAt(70)], 1, false);
cut.length = cut.length - 100;
var cutP = parseRing(cut);
ok("truncated fragment: whole segments kept", cutP.ok && cutP.values.length === 70, cutP.error);
ok("truncated fragment: tail reported", cutP.ok && cutP.tail === 257, "tail=" + (cutP.tail || ""));

/* Rejections. */
var badG = sliceArr(v2bytes, 0, v2bytes.length); badG[4] ^= 0xFF;   // interval, CRC now stale
ok("bad global header CRC rejected", !parseRing(badG).ok);
var badV = sliceArr(v2bytes, 0, v2bytes.length); badV[2] = 9;
ok("unknown version rejected", !parseRing(badV).ok);
var badGeom = sliceArr(v2bytes, 0, v2bytes.length);
badGeom[6] = 100; badGeom[7] = 0;                                   // 100 is not a multiple of 3
var c2 = crc16Range(badGeom, 0, 16, -1); badGeom[16] = c2 & 0xFF; badGeom[17] = (c2 >> 8) & 0xFF;
ok("segment size not a multiple of 3 rejected", !parseRing(badGeom).ok);

/* The ring's chart plots against absolute index, so a gap must break it. */
if (typeof chartSVG === "function" && gap.ok) {
  var dense = [], want = gap.indices[0], gi;
  for (gi = 0; gi < gap.indices.length; gi++) {
    while (want < gap.indices[gi]) { dense.push(-2048); want++; }
    dense.push(gap.values[gi]); want++;
  }
  var gsvg = chartSVG(dense, gap.intervalS, gap.indices[0]);
  ok("gap breaks the chart trace", !!gsvg && gsvg.indexOf('class="gap"') > 0);
}

WScript.Echo("");
WScript.Echo(fail === 0 ? ("ALL " + pass + " CHECKS PASSED") : (fail + " FAILED of " + (pass + fail)));
WScript.Quit(fail === 0 ? 0 : 1);
