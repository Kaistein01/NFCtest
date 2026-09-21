// Harness: shims the browser things the extracted sections touch, then
// exercises them. The page's sections S1-S9 are spliced in verbatim from
// index.html by run-jstest.ps1, and so is demo/demo-url.txt - this file never
// contains a copy of either. Runs under Windows' JScript, so ES3 only.

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

/* ===== PAGE SOURCE SPLICED IN HERE ===== */
//<<<SPLICE>>>

/* ===== demo/demo-url.txt SPLICED IN HERE ===== */
//<<<DEMO>>>

/* ===== tests ===== */

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; WScript.Echo("  PASS  " + name); }
  else { fail++; WScript.Echo("  FAIL  " + name + (detail ? "  -- " + detail : "")); }
}
function title(t) { WScript.Echo(""); WScript.Echo("=== " + t + " ==="); }
function bytesOf(b64) { var d = b64decode(b64); if (d.error) { throw new Error(d.error); } return d.bytes; }
function sameAsGolden(p) {
  if (!p.ok || p.values.length !== GOLDEN.length) { return false; }
  for (var i = 0; i < GOLDEN.length; i++) { if (p.values[i] !== GOLDEN[i]) { return false; } }
  return true;
}
function has(s, part) { return String(s).indexOf(part) >= 0; }

title("self-test, as the page runs it on load");
var st = selfTest();
ok("self-test: " + st.msg, st.ok);

/* ===== reference vectors ===== */

title("v2 reference vector");
var v2bytes = bytesOf(GOLDEN_V2);
var pr = parseRing(v2bytes);
ok("parses", pr.ok, pr.error);
if (pr.ok) {
  ok("70 samples", pr.values.length === 70, "got " + pr.values.length);
  ok("interval 10 s", pr.intervalS === 10);
  ok("geometry 357 x 17", pr.segBytes === 357 && pr.segTotal === 17, pr.segBytes + " x " + pr.segTotal);
  ok("one segment, readable", pr.segOk === 1 && pr.segDamaged === 0);
  ok("not wrapped", pr.wrapped === false);
  ok("nothing overwritten", pr.overwritten === 0);
  ok("newest is #69", pr.newest === 69, "got " + pr.newest);
  ok("two faults at 42 and 47", pr.faults.join(",") === "42,47", pr.faults.join(","));
  ok("decodes to exactly the GOLDEN series", sameAsGolden(pr));
  ok("v2 has no start time", pr.startUtc === null);
}

title("v3 reference vector");
var v3bytes = bytesOf(GOLDEN_V3);
var p3 = parseRing(v3bytes);
ok("parses", p3.ok, p3.error);
ok("version 3, 21-byte header", p3.version === 3 && p3.size.global === 21);
ok("start time 1790000000", p3.startUtc === 1790000000, "got " + p3.startUtc);
ok("decodes to exactly the same series as v2", sameAsGolden(p3));
ok("same segment bytes as v2", p3.size.payload === pr.size.payload);

/* ===== constructed rings =====
   The page has no encoder, so these rings are built out of the one real
   segment the firmware produced: copy it, change its header, fix its CRC. They
   run once as v2 and once as v3 - the segments are the same in both. */

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
function segAt(first, count) {
  var s = sliceArr(v2bytes, V2_GLOBAL, 357);
  put32(s, 0, first);
  if (count !== undefined) { s[4] = count & 0xFF; s[5] = (count >> 8) & 0xFF; }
  fixSegCrc(s);
  return s;
}
function header(version, openSeg, wrapped, start) {
  var g = sliceArr(v2bytes, 0, 14), c;
  g[2] = version; g[9] = openSeg; g[10] = wrapped ? 1 : 0;
  if (version === 3) {
    g.push(start & 0xFF); g.push((start >> 8) & 0xFF); g.push((start >> 16) & 0xFF); g.push((start >>> 24) & 0xFF);
    g.push(0);
  } else {
    g.push(0); g.push(0);
  }
  c = crc16Range(g, 0, g.length, -1);
  g.push(c & 0xFF); g.push((c >> 8) & 0xFF);
  return g;
}
function buildRing(version, segs, openSeg, wrapped) {
  var g = header(version, openSeg, wrapped, 1790000000), i, j;
  for (i = 0; i < segs.length; i++) {
    for (j = 0; j < segs[i].length; j++) { g.push(segs[i][j]); }
  }
  return g;
}

var versions = [2, 3];
for (var vi = 0; vi < versions.length; vi++) {
  var V = versions[vi], L = "v" + V + " ";
  title("v" + V + " ring, constructed cases");

  var two = parseRing(buildRing(V, [segAt(0), segAt(70)], 1, false));
  ok(L + "two segments: 140 samples", two.ok && two.values.length === 140, two.ok ? "got " + two.values.length : two.error);
  ok(L + "two segments: indices run 0..139", two.ok && two.indices[0] === 0 && two.indices[139] === 139);
  ok(L + "two segments: no gaps", two.ok && two.gaps === 0 && two.gapList.length === 0);
  ok(L + "start time read as the version says",
     two.ok && (V === 3 ? two.startUtc === 1790000000 : two.startUtc === null));

  var rev = parseRing(buildRing(V, [segAt(70), segAt(0)], 0, true));
  ok(L + "out-of-order slots are sorted by first sample index",
     rev.ok && rev.indices[0] === 0 && rev.indices[139] === 139, rev.error);
  ok(L + "wrapped flag is read", rev.ok && rev.wrapped === true);

  var gap = parseRing(buildRing(V, [segAt(0), segAt(100)], 1, false));
  ok(L + "gap: counted", gap.ok && gap.gaps === 1, gap.ok ? "gaps=" + gap.gaps : gap.error);
  ok(L + "gap: 30 samples reported missing", gap.ok && gap.missing === 30);
  ok(L + "gap: listed as #70..#99", gap.ok && gap.gapList.length === 1 &&
     gap.gapList[0].from === 70 && gap.gapList[0].to === 99);
  ok(L + "gap: both sides still decode", gap.ok && gap.values.length === 140);

  var bad = segAt(70); bad[40] ^= 0xFF;
  var dmg = parseRing(buildRing(V, [segAt(0), bad], 1, false));
  ok(L + "damaged segment: skipped", dmg.ok && dmg.segDamaged === 1, dmg.error);
  ok(L + "damaged segment: the good one survives", dmg.ok && dmg.values.length === 70);

  var allBad = segAt(0); allBad[40] ^= 0xFF;
  var none = parseRing(buildRing(V, [allBad], 0, false));
  ok(L + "every segment damaged is an error", !none.ok && /no readable segment/.test(none.error), none.error);

  var emp = parseRing(buildRing(V, [segAt(0), segAt(0, 0)], 0, false));
  ok(L + "empty segment counted and skipped", emp.ok && emp.segEmpty === 1 && emp.values.length === 70, emp.error);

  var fresh = parseRing(buildRing(V, [segAt(0, 0)], 0, false));
  ok(L + "fresh log: reported as empty, not as damage", !fresh.ok && /log is empty/.test(fresh.error), fresh.error);

  var ovr = parseRing(buildRing(V, [segAt(500), segAt(570)], 1, true));
  ok(L + "overflow: 500 samples reported overwritten", ovr.ok && ovr.overwritten === 500,
     ovr.ok ? "got " + ovr.overwritten : ovr.error);
  ok(L + "overflow: newest is #639", ovr.ok && ovr.newest === 639);

  var cut = buildRing(V, [segAt(0), segAt(70)], 1, false);
  cut.length = cut.length - 100;
  var cutP = parseRing(cut);
  ok(L + "truncated fragment: whole segments kept", cutP.ok && cutP.values.length === 70, cutP.error);
  ok(L + "truncated fragment: tail reported", cutP.ok && cutP.tail === 257, "tail=" + (cutP.tail || ""));

  var hdrLen = V === 3 ? 21 : 18;
  var badG = buildRing(V, [segAt(0)], 0, false); badG[4] ^= 0xFF;
  ok(L + "bad global header CRC rejected", !parseRing(badG).ok);
  var badC = buildRing(V, [segAt(0)], 0, false); badC[hdrLen - 1] ^= 0x01;
  ok(L + "a flipped CRC byte at the " + hdrLen + "-byte header's end is rejected", !parseRing(badC).ok);
  var badGeom = header(V, 0, false, 1790000000);
  badGeom[6] = 100; badGeom[7] = 0;
  var cg = crc16Range(badGeom, 0, hdrLen - 2, -1);
  badGeom[hdrLen - 2] = cg & 0xFF; badGeom[hdrLen - 1] = (cg >> 8) & 0xFF;
  var sg0 = segAt(0), q;
  for (q = 0; q < sg0.length; q++) { badGeom.push(sg0[q]); }
  ok(L + "segment size not a multiple of 3 rejected", !parseRing(badGeom).ok);

  if (gap.ok) {
    var dense = [], want = gap.indices[0], gi;
    for (gi = 0; gi < gap.indices.length; gi++) {
      while (want < gap.indices[gi]) { dense.push(FAULT); want++; }
      dense.push(gap.values[gi]); want++;
    }
    var gsvg = chartSVG(dense, gap.intervalS, gap.indices[0]);
    ok(L + "gap breaks the chart trace", !!gsvg && has(gsvg, 'class="gap"'));
  }
}

title("versions");
var badV = sliceArr(v2bytes, 0, v2bytes.length); badV[2] = 9;
ok("unknown version rejected", !parseRing(badV).ok);
var v4 = sliceArr(v3bytes, 0, v3bytes.length); v4[2] = 4;
ok("version 4 rejected by name", /format version 4/.test(parseRing(v4).error));
ok("a v1 container is rejected, not misread", /format version 1/.test(parseRing(bytesOf("VEwBAUYACgAAAAAADAUAAA3BV6JeAAAA")).error));

/* ===== the URL ===== */

title("URL");
var u = parseLocation("?id=45KP21094K9001", "#VEwD");
ok("?id= read", u.idValid && u.id === "45KP21094K9001" && u.frag === "VEwD" && !u.demo);
ok("lowercase accepted", parseLocation("?id=45kp21094k9001", "").id === "45KP21094K9001");
ok("%20 spaces removed", parseLocation("?id=45KP%2021094%20K9001", "").idValid);
ok("+ spaces removed", parseLocation("?id=45KP+21094+K9001", "").idValid);
ok("hyphens removed", parseLocation("?id=45KP-21094-K9001", "").idValid);
ok("missing id", parseLocation("", "#x").idRaw === null && !parseLocation("", "#x").idValid);
ok("13 characters invalid", !parseLocation("?id=45KP21094K900", "").idValid);
ok("15 characters invalid", !parseLocation("?id=45KP21094K90012", "").idValid);
ok("other parameters alongside", parseLocation("?x=1&id=45KP21094K9001&y=2", "").idValid);
ok("a broken %-sequence does not throw", parseLocation("?id=%E0%A4%A", "").idValid === false);
ok("script in the id is just an invalid id", !parseLocation("?id=%3Cimg%20src%3Dx%3E", "").idValid);
ok("ID shown grouped 4-5-5", fmtId("45KP21094K9001") === "45KP 21094 K9001");

/* ===== the derived model =====
   Rings in the shape parseRing returns, built directly so each rule can be
   put exactly at its edge. */

var S = 1790000000, I = 900, IMS = I * 1000, SHIP = { alarm: { low: 0, high: 300 } };

function mkRing(values, o) {
  o = o || {};
  var r = { values: [], indices: [], faults: [], gapList: [], startUtc: o.start === undefined ? S : o.start,
            intervalS: o.interval || I, newest: 0, overwritten: 0, segOk: 1, segEmpty: 0,
            segDamaged: o.damaged || 0, present: 1 + (o.damaged || 0), size: { payload: 100 } };
  var idx = o.first || 0, i;
  r.overwritten = idx;
  for (i = 0; i < values.length; i++) {
    if (o.gapAt === i) { r.gapList.push({ from: idx, to: idx + o.gapLen - 1 }); idx += o.gapLen; }
    r.indices.push(idx);
    r.values.push(values[i]);
    if (values[i] === FAULT) { r.faults.push(idx); }
    idx++;
  }
  r.newest = r.indices[r.indices.length - 1];
  return r;
}
function flat(n, v) { var a = [], i; for (i = 0; i < n; i++) { a.push(v); } return a; }
var tLast = (S + 9 * I) * 1000;                  // newest of a 10-sample ring from S
var ten = mkRing(flat(10, 200));

title("time");
var m = summarize(ten, tLast + 7 * 60000, SHIP, null, false);
ok("exact mode from a start time", m.mode === "exact");
ok("t(0) is the start time", m.at(0) === S * 1000);
ok("t(i) = start + i x interval", m.at(9) === tLast);
ok("age of the newest reading", m.ageMs === 420000);
ok("'7 minutes ago'", m.lastText === "7 minutes ago", m.lastText);
ok("< 1 min: 'just now'", summarize(ten, tLast + 30000, SHIP, null, false).lastText === "just now");
ok("small negative age: 'just now'", summarize(ten, tLast - 60000, SHIP, null, false).lastText === "just now");
ok("at interval + 30 s: still counted", summarize(ten, tLast + IMS + 30000, SHIP, null, false).lastText === "15 minutes ago");
var drift = summarize(ten, tLast + IMS + 31000, SHIP, null, false);
ok("past interval + 30 s: 'within the last 15 minutes'", drift.lastText === "within the last 15 minutes", drift.lastText);
ok("... and not stale", !drift.stale && drift.health.state === "ok");

var thr = (2 * IMS + 30000 + 0.02 * 8100000) / 0.98;   // age at which stale starts
var below = summarize(ten, tLast + Math.floor(thr) - 1, SHIP, null, false);
var above = summarize(ten, tLast + Math.ceil(thr) + 1000, SHIP, null, false);
ok("stale: 1 ms below the threshold is not stale", !below.stale);
ok("stale: 1 s past the threshold is stale", above.stale);
ok("stale: health red, naming the last measurement",
   above.health.state === "bad" && has(above.health.text, "No measurement since " + fmtUTC(tLast)), above.health.text);

var notFut = summarize(ten, tLast - 270000, SHIP, null, false);
var fut = summarize(ten, tLast - 290000, SHIP, null, false);
ok("future: within the tolerance it is not flagged", !notFut.future && notFut.health.state === "ok");
ok("future: beyond it, amber", fut.future && fut.health.state === "warn" && fut.health.text === "Logger time ahead of this phone");

var est = summarize(mkRing(flat(10, 200), { start: null }), tLast, SHIP, null, false);
ok("no start time: estimated mode", est.mode === "estimated" && est.at(9) === tLast);
ok("no start time: 'within the last 15 minutes (estimated)'", est.lastText === "within the last 15 minutes (estimated)");
ok("no start time: amber", est.health.state === "warn" && est.health.text === "Log has no start time (old format)");
ok("no start time: never stale", !summarize(mkRing(flat(10, 200), { start: null }), tLast + 99 * IMS, SHIP, null, false).stale);

var ov = summarize(mkRing(flat(10, 200), { first: 500 }), (S + 509 * I) * 1000, SHIP, null, false);
ok("overflow as a time range", ov.samplesText === "10 kept, 500 earlier no longer on the tag (" +
   fmtShort(S * 1000) + " – " + fmtShort((S + 499 * I) * 1000) + ")", ov.samplesText);
ok("start time shown", ov.startText === fmtUTC(S * 1000));

var early = summarize(ten, tLast, SHIP, { email: "a@b.c", at: S * 1000 - 1000 }, false);
ok("confirmation before the start: empty window", early.windowEmpty && early.max === null);
ok("confirmation before the start: no alarm status", early.alarm.state === "none" && has(early.alarm.text, "Cannot judge"));

title("statistics");
var sv = summarize(mkRing([200, 250, 250, 180, 180, 210]), (S + 5 * I) * 1000, SHIP, null, false);
ok("max value and the earliest of a tie", sv.max.value === 250 && sv.max.index === 1 && sv.max.time === (S + I) * 1000);
ok("min value and the earliest of a tie", sv.min.value === 180 && sv.min.index === 3);
var cutw = summarize(mkRing([200, 250, 250, 180, 180, 210]), (S + 9 * I) * 1000, SHIP, { email: "a@b.c", at: (S + 2 * I) * 1000 }, false);
ok("window cut at the confirmation", cutw.max.value === 250 && cutw.min.value === 200 && cutw.min.index === 0);

title("alarm");
function alarmOf(values, o, conf) {
  var r = mkRing(values, o);
  return summarize(r, (S + (r.newest + 1) * I) * 1000, (o && o.ship) || SHIP, conf || null, false).alarm;
}
ok("exactly at the upper limit: green", alarmOf([200, 300, 200]).state === "ok");
ok("exactly at the lower limit: green", alarmOf([200, 0, 200]).state === "ok");
var a1 = alarmOf([200, 301, 200]);
ok("0.1 C above: red", a1.state === "bad" && a1.text === "1 reading above 30.0 °C, first " + fmtUTC((S + I) * 1000), a1.text);
var a2 = alarmOf([200, -1, 200, 305, 310]);
ok("above and below, counted", a2.state === "bad" && a2.text === "2 readings above 30.0 °C and 1 below 0.0 °C, first " + fmtUTC((S + I) * 1000), a2.text);
ok("an excursion after the confirmation: green",
   alarmOf([200, 200, 400], null, { email: "a@b.c", at: (S + I) * 1000 }).state === "ok");
ok("faults and a gap: still green", alarmOf([200, FAULT, 200, 200], { gapAt: 3, gapLen: 20 }).state === "ok");
ok("overwritten readings: still green", alarmOf(flat(5, 200), { first: 900 }).state === "ok");
var staleRing = mkRing(flat(5, 200));
ok("stale logger: still green", summarize(staleRing, (S + 99999 * I) * 1000, SHIP, null, false).alarm.state === "ok");
ok("no start time: still green", alarmOf(flat(5, 200), { start: null }).state === "ok");
ok("only faults in the window: no status", alarmOf([FAULT, FAULT]).state === "none");

title("health");
ok("missing readings alone: green", summarize(mkRing([200, FAULT, 200], { gapAt: 2, gapLen: 7 }), (S + 11 * I) * 1000, SHIP, null, false).health.state === "ok");
var dmgRing = mkRing(flat(5, 200), { damaged: 1 });
var dm = summarize(dmgRing, (S + 5 * I) * 1000, SHIP, null, false);
ok("a damaged segment alone: green", dm.health.state === "ok");
ok("a damaged segment: CRC FAIL in Details", !dm.crcOk && dm.crcText === "FAIL — 1 of 2 segments damaged, skipped", dm.crcText);
ok("overwriting alone: green", summarize(mkRing(flat(5, 200), { first: 800 }), (S + 805 * I) * 1000, SHIP, null, false).health.state === "ok");
var nf = summarize(mkRing([200, 210, FAULT]), (S + 3 * I) * 1000, SHIP, null, false);
ok("a fault at the newest reading: red", nf.health.state === "bad" && nf.health.text === "Sensor fault at the last measurement");
ok("... and the temperature shown is the last valid one", nf.current.value === 210);
ok("CRC OK text", summarize(ten, tLast, SHIP, null, false).crcText === "OK — header and 1 of 1 segments verified");

title("missing readings");
var mr = summarize(mkRing([200, 200, 200, FAULT, FAULT, 200, 200, 200, FAULT], { gapAt: 7, gapLen: 5 }), (S + 20 * I) * 1000, SHIP, null, false);
ok("faults merged into runs, gaps listed, oldest first", mr.missing.length === 3 &&
   mr.missing[0].kind === "fault" && mr.missing[0].from === 3 && mr.missing[0].to === 4 &&
   mr.missing[1].kind === "gap" && mr.missing[1].from === 7 && mr.missing[1].to === 11 &&
   mr.missing[2].kind === "fault" && mr.missing[2].from === 13);
ok("counted with their times", mr.missingText === "8 — 2 sensor faults (" + fmtShort((S + 3 * I) * 1000) + " – " +
   fmtShort((S + 4 * I) * 1000) + "), 5 missing between segments (" + fmtShort((S + 7 * I) * 1000) + " – " +
   fmtShort((S + 11 * I) * 1000) + "), 1 sensor fault (" + fmtShort((S + 13 * I) * 1000) + ")", mr.missingText);
ok("overwritten readings are not counted", summarize(mkRing(flat(5, 200), { first: 900 }), (S + 905 * I) * 1000, SHIP, null, false).missingText === "0");

title("demo");
var NOW = (S + 30 * 86400) * 1000;
var dmo = summarize(ten, NOW, SHIP, null, true);
ok("demo mode", dmo.mode === "demo");
ok("newest reading at load time - 7 min", dmo.at(9) === NOW - 420000);
ok("'7 minutes ago'", dmo.lastText === "7 minutes ago");
ok("never stale, whatever the header says", !dmo.stale && dmo.health.state === "ok");
ok("no start time needed: not amber", summarize(mkRing(flat(10, 200), { start: null }), NOW, SHIP, null, true).health.state === "ok");
ok("demo stores no confirmation (key null)", confirmationKey("45KP21094K9001", S, true) === null);
ok("live key per logger and run", confirmationKey("45KP21094K9001", S, false) === "libero:45KP21094K9001:" + S);
ok("live key without a start time", confirmationKey("45KP21094K9001", null, false) === "libero:45KP21094K9001:unknown");
ok("demo=1 read", parseLocation("?id=45KP21094K9001&demo=1", "").demo === true);
ok("demo=0 and demo=yes ignored", !parseLocation("?demo=0", "").demo && !parseLocation("?demo=yes", "").demo);

var qAt = DEMO_URL.indexOf("?"), hAt = DEMO_URL.indexOf("#");
var dl = parseLocation(DEMO_URL.slice(qAt, hAt), DEMO_URL.slice(hAt));
ok("demo URL: id and flag", dl.idValid && dl.id === "45KP21094K9001" && dl.demo);
var dr = parseRing(bytesOf(dl.frag));
ok("demo URL: decodes", dr.ok, dr.error);
if (dr.ok) {
  ok("demo URL: 10,500 readings", dr.values.length === 10500, "got " + dr.values.length);
  ok("demo URL: 9 of 9 segments - about half the tag - none damaged", dr.segOk === 9 && dr.present === 9 && dr.segDamaged === 0);
  ok("demo URL: 15-minute interval", dr.intervalS === 900);
  var dm2 = summarize(dr, NOW, SHIP, null, true);
  ok("demo URL: 0 missing", dm2.missingText === "0" && dr.faults.length === 0 && dr.gaps === 0);
  ok("demo URL: all within 0.0 ... 30.0 C", dm2.min.value >= 0 && dm2.max.value <= 300, dm2.min.value + " .. " + dm2.max.value);
  ok("demo URL: range 17.9 ... 29.0 C", dm2.min.value === 179 && dm2.max.value === 290, dm2.min.value + " .. " + dm2.max.value);
  ok("demo URL: health green", dm2.health.state === "ok");
  ok("demo URL: '7 minutes ago'", dm2.lastText === "7 minutes ago");
  ok("demo URL: 2.32 bits per sample", dm2.bitsText === "2.32", dm2.bitsText);
  var dm3 = summarize(dr, NOW, SHIP, { email: "a@b.c", at: NOW + 60000 }, true);
  ok("demo URL: alarm green after confirming", dm3.alarm.state === "ok" && dm3.alarm.text === "No excursion");
}

/* ===== chart ===== */

title("chart");
var cv = [], ci;
for (ci = 0; ci < 1024; ci++) { cv.push(270 + (ci % 5 === 0 ? 1 : 0)); }
cv[500] = FAULT;
var svg = chartSVG(cv, 1, 0);
ok("returns markup", !!svg && svg.indexOf("<svg") === 0);
ok("has a trace path", has(svg, 'class="line"'));
ok("marks the fault gap", has(svg, 'class="gap"'));
var segs = svg.split("M").length - 1;
ok("trace is broken at the fault (2 subpaths)", segs === 2, segs + " subpaths");
ok("all-fault log yields no chart", chartSVG(flat(20, FAULT), 1, 0) === null);
var fsvg = chartSVG(flat(50, 270), 1, 0);
ok("flat log still renders", !!fsvg && has(fsvg, 'class="line"'));
ok("flat log y-axis spans >= 1 C", has(fsvg, "26.5") || has(fsvg, "26.6"), "min-span floor not applied");
ok("marker drawn when requested", has(chartSVG(cv, 900, 0, { marker: 100 }), 'class="mark"'));
ok("marker outside the data not drawn", !has(chartSVG(cv, 900, 0, { marker: 5000 }), 'class="mark"'));
var lsvg = chartSVG(cv, 900, 0, { label: function (k) { return "L" + k; } });
ok("label formatter used", has(lsvg, ">L0<") && has(lsvg, ">L1023<"));
ok("default output unchanged without options", chartSVG(cv, 900, 0) === chartSVG(cv, 900, 0, undefined) && has(chartSVG(cv, 900, 0), ">0 s<"));
var dsvg = chartSVG(dr.ok ? dr.values : [], 900, 0);
ok("10,500 readings render, downsampled", !!dsvg && dsvg.length < 40000, dsvg ? dsvg.length + " chars" : "none");

title("alarm config");
ok("no alarm block: no status", alarmOf([200, 200], { ship: {} }).state === "none" && alarmOf([200, 200], { ship: {} }).text === "No alarm limits configured");
ok("no shipment: no status, never green", summarize(ten, tLast, null, null, false).alarm.state === "none");

WScript.Echo("");
WScript.Echo(fail === 0 ? ("ALL " + pass + " CHECKS PASSED") : (fail + " FAILED of " + (pass + fail)));
WScript.Quit(fail === 0 ? 0 : 1);
