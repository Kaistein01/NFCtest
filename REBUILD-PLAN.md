# NFCtest rebuild — feasibility report

Assessment and plan for rebuilding `index.html` so it accepts a tempcomp v1 Base64URL string,
decodes it, plots the samples over time, and reports the transport and compression properties.

Status: **implemented.** All five phases of section 10 are done and verified; the outcome, the
one deviation from the file list, and the test results are in section 13.

Companion documents: `../../COMPRESSION-PLAN.md` (format spec, section 6; decode procedure,
section 8) and `../../tempcomp/README.md`.

---

## 1. Verdict

**Feasible, with no serious technical risk.** Every requested capability is achievable inside
the existing constraints — one static file, no build step, no dependencies, no network requests
after load. Nothing here needs a library.

The work is dominated by two things that are well understood rather than hard: porting a
decoder that already has three independently verified implementations, and hand-rolling a
line chart in inline SVG.

All open decisions are settled — see section 9. The page is **overwritten in place** and keeps
the URL `https://kaistein01.github.io/NFCtest/`.

### Governing principle: as simple as possible

Every choice below is the smallest thing that does the job. Concretely, this rules out:

- **No JavaScript encoder.** The page decodes only. Writing an encoder would put a fifth
  implementation of the format in the codebase, doubling the surface that has to stay in
  agreement, to solve a problem nobody has — real payloads come from the board. Test payloads
  come from the embedded golden vector and two canned real dumps.
- **No build step, no bundler, no modules, no framework.** One file, plain ES5-compatible
  script, same as today.
- **No chart library**, no zoom, no pan, no tooltips, no CSV export.
- **One compression baseline**, not three (section 7).
- **No state between renders.** Parse is a pure function; render consumes its output.

Where simplicity and correctness conflict, correctness wins — the runtime self-test in
section 5 stays, because a decoder nobody can check is worse than no decoder.

---

## 2. What exists today

A single 13.6 KB `index.html`, live at `https://kaistein01.github.io/NFCtest/`. It is a
well-built instrument and the rebuild should inherit most of it rather than start over.

**Worth keeping as-is:**

| | |
|---|---|
| Zero-dependency single file | Non-negotiable. A page reached by tapping a tag may load on a poor connection; a CDN fetch is a failure mode you cannot debug in the field. |
| No YAML front matter | Makes Jekyll copy it byte-for-byte. Easy to lose accidentally. |
| `prefers-color-scheme` theming | Already correct in both modes. |
| Mobile-first layout | This page is read on a phone, seconds after a tap. The oversized headline number is the right instinct. |
| `hashchange` re-render | Lets you edit the fragment in the address bar to test without re-tapping. |
| Alphabet detection (`base64url` / `standard` / `mixed (suspect)`) | Still valuable — distinguishes corruption from truncation. |
| Navigation Timing cross-check of URL length | Independent second reading; catches truncation in the navigation layer rather than at the tag. |
| Tolerant base64 decode (missing padding, truncated trailing group) | Directly reusable. |
| "Copy report row" as TSV | The thing that makes field testing bearable. |
| `crypto.subtle` with an FNV-1a fallback | Correct — `crypto.subtle` is absent on non-secure origins, which a field test can hit. |

**What becomes obsolete:** the ruler generator (`makeRuler`, `lastIntactMarker`) and the
payload preview, *if* the page stops accepting ruler payloads. See section 3 — the
recommendation is that it should not.

---

## 3. The core tension: the ruler and the container are opposites

The existing page works because its payload is **self-describing under truncation**. Cut the
ruler anywhere and the surviving tail still states its own length. That property is the whole
instrument.

The tempcomp container is the opposite by design. It is a CRC-protected, delta-coded bitstream.
Truncate it and the CRC fails — which is correct behaviour, and tells you *that* something
broke, but nothing about *how much* survived. A page that only accepts tempcomp payloads
**loses the measurement capability the page was built for.**

That said, the situation is better than it first appears, and this is the most useful finding
in this report:

> **A truncated tempcomp payload degrades gracefully.** The header sits at the front and
> carries `sample_count`. The Rice stream is a forward delta chain, so every sample decoded
> before the cut is *correct*. A decoder that is willing to ignore the CRC can decode until it
> runs out of bits and then report "header promised 1024 samples, 617 arrived" — which is a
> truncation measurement, in samples, plus usable data.

The distinction that must be preserved in the UI: **truncation is recoverable, corruption is
not.** A bit-flip mid-stream also fails the CRC, but silently corrupts every subsequent sample
in the delta chain. So a "decode past the CRC failure" mode is legitimate and useful, but must
be clearly labelled diagnostic-only, and must never be the default.

### Decision: dual mode, auto-detected

Keep both payload types. Detection is trivial and exact:

> A tempcomp v1 blob always begins with bytes `'T' 'L' 0x01`, which base64-encode to the
> literal prefix **`VEwB`**. Both real dumps confirm it. Anything else falls through to the
> ruler path.

This costs almost nothing, preserves the instrument, and means one page serves both purposes:

- **Purpose A (original):** how much URL fragment does this phone actually deliver? Needs the
  ruler and deliberately large payloads.
- **Purpose B (new):** decode and visualise a real temperature log. Payloads are small.

They do not conflict, and A de-risks B at scale.

---

## 4. Has compression made Purpose A moot?

Largely, at today's log sizes — worth stating plainly so nobody over-invests in it.

The page's own budget: base URL `https://kaistein01.github.io/NFCtest/#` is **38 characters**,
leaving 30 bytes on the tag after the NDEF `0x04` prefix strips `https://`.

| Payload | blob | Fragment | Full URL | Tap time @53 kbit/s |
|---|---:|---:|---:|---:|
| 1024 samples, 1 s, 1 fault (measured) | 168 B | 224 ch | 262 ch | 25 ms |
| 1024 samples, 1 s (measured) | 199 B | 266 ch | 304 ch | 30 ms |
| 1024 samples, 10 s (projected) | 296 B | 395 ch | 433 ch | 45 ms |

Against a fragment headroom the README estimates at ~8100 characters, a 1024-sample log uses
**3 %** of it. The original page was probing 8000-character fragments; the real payload is
under 300. The limit it was built to find is no longer anywhere near the operating point.

Where Purpose A becomes load-bearing again is if the log grows to fill the tag:

| Rate | Samples in ~6075 B of blob | At 1 s | At 10 s |
|---|---:|---:|---:|
| 1.14 bits/sample (measured, flat) | 42,491 | 11.8 h | 118 h |
| 1.40 bits/sample (measured) | 34,600 | 9.6 h | 96 h |
| 1.90 bits/sample (measured, 10 s) | 25,494 | 7.1 h | 71 h |
| 3.51 bits/sample (worst modelled) | 13,800 | 3.8 h | 38 h |

At those sizes the fragment is 4000–8000 characters and the phone's URL handling matters again.
So: keep the probe, do not prioritise it.

---

## 5. Feasibility by feature

| Feature | Risk | Notes |
|---|---|---|
| Base64URL → bytes | **None** | Existing `b64decode` is directly reusable, including its padding tolerance. |
| Container parse + CRC-16/CCITT-FALSE | **None** | 16-byte header, bitwise CRC. Milliseconds. |
| Rice / zero-block / escape decode | **Low** | ~40 lines. Three verified implementations exist to port from and to check against. |
| Fault list → gaps | **None** | Already in the format; the decoders handle it. |
| Time-series chart | **Low** | Inline SVG, hand-rolled. See section 6. |
| Metrics panel | **None** | All values fall out of the parse. See section 7. |
| Block-option histogram | **None** | Free — the decoder already reads every option ID. |
| Truncation diagnostics | **Low** | Section 3's degraded mode. |
| Keeping it dependency-free | **None** | Nothing above needs a library. |
| Performance at 40k samples | **Low** | Bit-reading is linear and trivial; rendering needs downsampling (section 6). |

### The decoder port, and how to trust it

The format now has three implementations that agree: the C encoder on target, the C# model, and
`tldecode.ps1` / `tldecode.py`. A JavaScript decoder would be the fourth, and it will be the one
used in the field — so its correctness matters more than the others'.

**Strong recommendation: give the page the same self-test the firmware has.** Embed the
70-sample golden vector and its known Base64URL string, decode it on load or behind a button,
and assert the 70 values come back. It is ~200 bytes of constants and it closes exactly the gap
the firmware's `selftest` closes. Cheap, and it turns "the page probably decodes correctly" into
something checkable on the phone that is actually being used.

The golden vector already exercises every path: small deltas, a 32-sample zero-delta run, two
faults, both clamp limits, a jump wide enough to force the escape option, and a negative ramp.

---

## 6. Visualisation — the approach, and three data-specific traps

**Inline SVG, not Canvas.** SVG themes from CSS (so dark mode is free and stays consistent with
the rest of the page), stays crisp on a high-DPI phone, needs no redraw on theme change, and is
inspectable. Canvas would only win past ~10k points, and that is solvable by downsampling.

Above ~2000 points, downsample with **min/max per pixel column** rather than by decimation, so
a single-sample spike is never dropped. That is the difference between a chart you can trust
and one that quietly hides an excursion — which for a cold-chain product is the whole point.

Three traps specific to this data:

1. **Never interpolate across a fault.** A fault is missing data, not a value. Draw a break in
   the line and mark the gap. Drawing a straight line through it would invent a measurement,
   which for a metrology product is the worst possible failure. The `n/a` handling in the
   existing CLI decoders sets the right precedent.

2. **Use a stepped line, not a smooth one.** The data is quantised to 0.1 °C. A real log looks
   like a staircase across a handful of discrete levels — the 1024-sample capture spans just
   26.7 to 27.2, i.e. **six distinct values**. A linearly interpolated line implies intermediate
   readings that were never taken. `step-after` is the honest rendering.

3. **Clamp the Y-axis to a minimum span.** Auto-ranging on a flat log magnifies 0.1 °C of
   quantisation dither into what looks like violent oscillation. Enforce a floor of ~1 °C (and
   show the actual min/max numerically alongside), or a stable log will be read as an unstable
   one. This is the single most likely way for the finished page to mislead.

**X axis:** elapsed seconds, from `first_index × interval_s`. There is no RTC, so absolute time
is not in the format — offer an optional "read at" anchor that counts backwards from the newest
sample, matching what `tldecode.ps1 -Now` already does.

---

## 7. Metrics — two compression figures, precisely defined

Everything requested is derivable from the parse. Compression is reported as **one ratio plus
one rate**, both pinned to an explicit definition so the numbers cannot drift:

| Figure | Definition | On the measured log |
|---|---|---|
| **vs raw `int16`** | `samples × 2` bytes ÷ total blob bytes. The naive representation — one `int16` per sample, which is exactly what the board holds in RAM. | 2048 B ÷ 168 B = **12.2×** |
| **Bits per sample** | payload bits ÷ samples, **excluding** the 16-byte header, the fault section and the 2-byte CRC. | 146 B × 8 ÷ 1024 = **1.14** |

Why these two and nothing else:

- **`int16` is the only baseline that means anything without further explanation.** It is the
  uncompressed form of the same data, it needs no reconstruction step, and the reader can
  verify it mentally (`samples × 2`). A CSV baseline would require the page to reconstruct
  formatted text it never saw, and the resulting ratio would depend on index width and line
  endings rather than on the compressor — a number that flatters itself and teaches nothing.
- **Bits per sample is the figure that actually characterises the coder**, and the one that
  transfers across log lengths. The two must be quoted together: the ratio alone hides the
  container overhead, the rate alone hides it too but in the other direction.

The exclusion in the bits/sample definition matters. Quoting whole-blob bits/sample would make
short dumps look terrible for no reason — an 11-sample dump is 90 % container — and would make
the figure incomparable between a dump with faults and one without.

Panel contents:

- **Transport:** fragment characters, UTF-8 bytes, full URL length, Navigation Timing
  cross-check, on-tag bytes, estimated tap time at 53 kbit/s, tag headroom against 8192 B.
- **Container:** version, scheme, CRC status, byte breakdown (header / payload / fault section /
  CRC), sample count, interval, `first_index`, covered time span.
- **Compression:** the two figures above.
- **Data:** min, max, mean, span, fault count and their indices.
- **Coding detail:** histogram of block options — how many blocks used the zero-block code, each
  Rice *k*, and the escape. This is free from the decoder and is the most useful tuning
  diagnostic on the page: it shows directly whether the data is in the regime the format was
  designed for. Escapes appearing in a normal log would be a red flag worth seeing.

Panel contents:

- **Transport:** fragment characters, UTF-8 bytes, full URL length, Navigation Timing
  cross-check, on-tag bytes, estimated tap time at 53 kbit/s, tag headroom against 8192 B.
- **Container:** version, scheme, CRC status, byte breakdown (header / payload / fault section /
  CRC), sample count, interval, `first_index`, covered time span.
- **Compression:** bits/sample, the three ratios above.
- **Data:** min, max, mean, span, fault count and their indices, first and last timestamp.
- **Coding detail:** histogram of block options — how many blocks used the zero-block code, each
  Rice *k*, and the escape. This is free from the decoder and is the most useful tuning
  diagnostic on the page: it shows directly whether the data is in the regime the format was
  designed for. Escapes appearing in a normal log would be a red flag worth seeing.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| JS decoder disagrees with the reference | **High if it happens** | Embedded golden-vector self-test (section 5). Keep the PowerShell/Python as the reference of record. |
| Auto-ranged Y axis makes a stable log look unstable | Medium | Minimum span floor; show numeric min/max alongside. |
| Faults interpolated as real readings | **High if it happens** | Break the line; never bridge a gap. |
| "Ignore CRC" mode used as the default | Medium | Off by default, visually distinct, labelled diagnostic-only, and the resulting data marked unverified everywhere it appears. |
| Losing the ruler probe | Medium | Dual mode (section 3). |
| Accidental YAML front matter added | Low | Jekyll would then process it. Note it in the file header. |
| Browser percent-encodes the fragment | Low | Base64URL avoids every character that provokes it; normalise on read anyway. |
| Format v2 arrives, old page mis-decodes | Medium | The version byte exists — reject unknown versions loudly rather than guessing. |

---

## 9. Decisions — all settled

| # | Decision | Resolution |
|---|---|---|
| 1 | Dual mode, or tempcomp only? | **Dual, auto-detected on the `VEwB` prefix.** Preserves the instrument for near-zero cost. |
| 2 | Offer "decode past the CRC failure"? | **Yes, off by default**, visually distinct, labelled diagnostic-only. Converts a dead payload into a truncation measurement plus usable data. |
| 3 | Same page, or a new one? | **Overwrite `index.html` in place; keep the URL** `https://kaistein01.github.io/NFCtest/`. No redirect, no second page, no migration. The 38-character base URL stays part of the tag budget, which at 3 % utilisation is irrelevant. |
| 4 | Chart zoom/pan? | **No.** Static overview plus numeric min/max. Pinch-zoom on mobile SVG is fiddly and the payoff is unclear at 1024 points. |
| 5 | File size ceiling? | **No ceiling, but no padding either.** Estimated ~600 lines / ~24 KB (section 11). Simplicity is the constraint, not bytes. |

Consequence of decision 3 worth stating plainly: **the old page stops existing the moment this
ships.** Anything already written to a tag that points at this URL with a ruler fragment keeps
working — that is what decision 1 protects — but there is no way back to the current page
except through git history. That is the intended trade; it is a test instrument, not a
published service.

---

## 10. Phasing

Each step leaves a working, shippable page, in the same discipline the firmware spikes used.

| Phase | Deliverable | Acceptance |
|---|---|---|
| 0 | Decoder + golden-vector self-test, existing UI untouched | Self-test passes on desktop and on the phone |
| 1 | Container parse + metrics panel, no chart | Every number matches `tldecode.ps1` on both real dumps |
| 2 | SVG chart with fault gaps and stepped line | 1024-sample log renders; the fault visibly breaks the line |
| 3 | Dual-mode detection, ruler path restored | Both payload types render from the same page |
| 4 | Degraded decode and truncation report | A deliberately truncated fragment reports "617 of 1024 arrived" |

Phase 0 is the one that matters. If the decoder is right, everything after it is presentation.

---

## 11. Implementation detail

### 11.1 Files

| File | Action | Purpose |
|---|---|---|
| `index.html` | **overwrite** | The entire application: markup, style and script in one file. |
| `README.md` | **rewrite** | Currently documents only the ruler probe. Needs both purposes, the new payload type, and a revised test protocol. |
| `REBUILD-PLAN.md` | keep | This document. |
| `.nojekyll` | **add, empty** | See below. |

**No other files.** No build output, no assets, no `.js`, no `.css`, no fonts, no images. The
single-file rule is not stylistic: a page reached by tapping a tag may load on a bad connection
in a warehouse, and a second request is a failure mode you cannot diagnose from there.

**Why add `.nojekyll`:** today the file survives only because it happens to have no YAML front
matter, which makes Jekyll copy it verbatim. That is an invariant nobody can see and a future
edit can break silently — add three dashes at the top and Liquid starts interpreting `{{` in
the JavaScript. An empty `.nojekyll` disables Jekyll for the repository outright and removes
the entire class of problem for zero effort.

### 11.2 Structure of `index.html`

In file order. Estimated ~600 lines, ~24 KB.

| # | Section | ~Lines | Purpose |
|---|---|---:|---|
| — | `<head>`, meta, title | 6 | Unchanged apart from the title. |
| — | CSS | 90 | Existing custom properties and layout, plus ~25 lines of chart styling. Both themes already work. |
| — | Markup | 90 | See 11.3. |
| S1 | Helpers | 15 | `$()`, number formatting, safe text setting. |
| S2 | Base64 decode | 30 | **Reused unchanged** from the current page, including padding tolerance and alphabet detection. |
| S3 | CRC-16/CCITT-FALSE | 10 | Bitwise, no table. Poly `0x1021`, init `0xFFFF`, no reflect, no xorout. |
| S4 | Bit reader | 30 | MSB-first `read(n)`, `unary()` with cap, `align()`, `tell()`. |
| S5 | Container parser | 70 | Bytes → `{ok, error, version, scheme, count, intervalS, firstIndex, values[], faults[], blockStats{}, bytes{header,payload,faults,crc}}`. Pure function, no DOM. |
| S6 | Golden vector + self-test | 15 | 70 constants, expected string, one assertion loop. |
| S7 | Ruler path | 15 | **Reused unchanged**: `makeRuler`, `lastIntactMarker`. |
| S8 | Detect and dispatch | 20 | `VEwB` prefix → container path, else ruler path. |
| S9 | Metrics render | 70 | Object → tables. Mode-dependent. |
| S10 | SVG chart | 90 | See 11.4. |
| S11 | Generator + copy | 45 | **Reused unchanged**, plus canned "load sample" links. |

Sections S2, S7 and S11 are lifted from the current file with no edits. Roughly a third of the
finished page is code that is already in the field.

### 11.3 Markup, in reading order on a phone

1. **Title.**
2. **Headline card.** Switches by mode — one `if`. Container mode: sample count, then the
   temperature span. Ruler mode: fragment characters, then decoded bytes, exactly as today.
   Someone who taps a tag wants to see *what the log says* first, not a byte count.
3. **Status banner.** One colour-coded line, always present: `clean` / `CRC failed` /
   `decoded without CRC — unverified` / `not a tempcomp payload` / `unsupported version`. This
   is the most important element on the page and it belongs above the data, not below it.
4. **Chart.** Container mode only.
5. **Metrics tables.** Transport, container, compression, data, coding detail.
6. **Payload preview.** Ruler mode only — the chart replaces it in container mode.
7. **Environment**, **copy report row**, **generator**, **self-test result**.

### 11.4 The chart

Inline SVG built as a string and assigned once to `innerHTML`, not built node-by-node — simpler,
faster, and it makes the whole chart a single pure function of the parsed data.

- `viewBox` in data-independent units with `preserveAspectRatio="none"` avoided; instead compute
  a fixed viewBox (e.g. `0 0 600 220`) and let CSS scale it to the container width. Keeps the
  maths trivial and the stroke width predictable.
- **Stepped path** (`step-after`): a horizontal segment at each sample, a vertical jump at each
  change. Honest for quantised data (section 6).
- **Faults break the path.** Emit a new `M` after every gap rather than an `L`, and draw a
  distinct marker in the gap. Never bridge.
- **Downsample above ~2000 points** with min/max per pixel column, so a one-sample spike
  survives. Below that, plot every point.
- **Y axis:** data min/max padded by 5 %, then widened to a **minimum span of 1 °C**. Three
  gridlines with labels. Without the floor, a flat log renders as violent noise.
- **X axis:** elapsed seconds from `first_index × interval_s`, three ticks, human units
  (`s` / `min` / `h`).
- Colours come from the existing CSS custom properties, so both themes work with no extra code.

### 11.5 Why this is fail-proof

The design has no clever parts; its robustness comes from where the checks sit.

| Failure mode | Detected by | Page behaviour |
|---|---|---|
| Empty fragment | length check | Instructions, no error styling |
| Not a container | `VEwB` prefix absent | Falls through to the ruler path |
| Non-base64 characters | existing alphabet test | Named error; alphabet row shows `mixed (suspect)` if corruption |
| Any single-bit corruption | **CRC-16**, already measured at 500/500 in trials | Banner turns red, no data rendered unless degraded mode is explicitly enabled |
| Truncation | CRC fails, then bit reader runs out | Degraded mode reports "N of M arrived"; samples before the cut are provably correct |
| Unknown `version` | explicit byte check | Refuses and names the version. Never guesses. |
| Unknown `scheme` / `bits_per_sample ≠ 12` | explicit checks | Refuses. The page hardcodes 12-bit; the format permits others, so it must say so rather than mis-decode. |
| Corrupt stream causing an endless unary run | **cap in `unary()`** | Throws. Without this a bad payload hangs the phone — the one way this page could fail unrecoverably. |
| Reserved block option 15 | explicit check | Refuses. |
| Fault index past the end | bounds check | Refuses. |
| Zero samples | valid input | Renders an empty chart, not an error |
| 40,000 samples | downsampling | Bounded render work regardless of input size |
| SVG fails to render | — | Metrics are independent of the chart and still display |

Five structural properties do the rest:

1. **Runtime self-test on the real device.** The golden vector is checked in the browser that is
   actually being used, not on a build machine. A JS engine quirk shows up as a visible failure
   rather than as wrong temperatures.
2. **CRC before trust.** Nothing renders as data unless the CRC passes, with exactly one
   explicitly-labelled exception.
3. **Parse is a pure function; render consumes its result.** No shared mutable state, so the
   self-test exercises the same code path the page uses.
4. **Every render clears all output fields first.** `hashchange` re-renders in place, and a
   failed parse must not leave numbers from the previous successful one on screen. This is the
   single most likely correctness bug in the UI layer and the reason to reset unconditionally
   at the top of `render()` rather than per-branch.
5. **32-bit arithmetic is sufficient throughout.** The widest field read at once is 13 bits,
   sample values fit in 12, and JavaScript's bitwise operators are exactly 32-bit — so unlike
   the C encoder, which needed `write_u64_bits` and pulled in two `__aeabi` shift helpers,
   nothing here goes near `Number.MAX_SAFE_INTEGER` or needs care about precision.

And the property that underwrites all of it: **no dependencies, no build, no network.** What is
tested is byte-for-byte what runs. There is no CDN to go down, no transitive package to shift
under the page, and no build step whose output can differ from the source that was reviewed.

### 11.6 What could still go wrong

Being straight about the residual risk: the decoder is a fourth implementation of a format that
has three others, and agreement is checked at exactly one point — the golden vector. That
vector exercises every code path, but it is one sample series. If the JS decoder has a bug the
vector does not reach, the page will be confidently wrong.

Two cheap mitigations, both recommended:

- Ship the **two real 1024-sample dumps** as canned links alongside the golden vector, and check
  the page's rendering against `tldecode.ps1` output once, by hand, at Phase 1. That is three
  independent series rather than one.
- Keep `tldecode.py` / `tldecode.ps1` as the **reference of record**. When the page and the
  reference disagree, the reference wins until proven otherwise.

---

## 12. Test material already available

- Two real 1024-sample dumps with known-correct decodes, one containing a fault, both verified
  byte-for-byte against the host model.
- The 70-sample golden vector with its exact expected Base64URL.
- `tldecode.ps1` as an oracle to diff any page output against.
- Deliberately corrupted strings — a single bit-flip is already known to be caught by the CRC
  in 500/500 trials.

That is enough to validate the rebuild without needing the board.
## 13. Implementation record

### 13.1 Built as specified

All of section 10's phases are done, in one pass. The finished `index.html` is **1012 lines,
39.6 KB** against the ~600 line / 24 KB estimate in section 11.2 — 69 % over. The estimate was
optimistic about comment density and about the markup, not about the logic: the decoder came in
close to the ~140 lines projected for S3–S5. Roughly 3 KB is data rather than code (the golden
vector and the two canned real dumps).

Section 11.2's section numbering is intact, but **S10 (chart) sits ahead of S9 (render)** in the
file, because `render()` calls `chartSVG()`. Function hoisting makes the order semantically
irrelevant; defining the dependency first simply reads better.

### 13.2 One deviation from the file list

Section 11.1 said four files and "no other files". There are six: `tools/harness.js` and
`tools/run-jstest.ps1` were added.

The intent behind "no other files" was that **nothing extra is served** — no assets, no build
output, no second request from the page. That still holds; these two are development tooling,
never fetched by the browser. The alternative was verification that existed only in a session
scratchpad and would vanish, which is worse than two files nobody downloads.

### 13.3 Verified by running the real source

The build machine has no browser, but Windows ships a JScript engine. `tools/run-jstest.ps1`
**splices the decoder straight out of `index.html`** — sections S1–S6 and S10, located by their
comment markers — into a harness that shims the three browser things they touch (`atob`,
`Uint8Array`, `window`). What is tested is the source that ships, not a transcription.

**47 checks, all passing:**

| Group | Covers |
|---|---|
| Self-test | The 70-sample golden vector decodes exactly |
| Real log 1 | 1024 samples, `first_index` 20, CRC, range 26.7–27.2, all twelve 27.2 positions, the single 26.7 at 929, 179 B payload, breakdown sums to the blob, 1.40 bits/sample, 10.3× |
| Real log 2 | 1024 samples with a fault: fault at absolute 4713, neighbours intact at 27.0/27.1, 168 B, 4 B fault section, 1.14 bits/sample, 12.2×, zero-blocks fired and no escapes |
| Rejection | Flipped payload bit, bad magic, wrong version, runt blob, truncated blob with the CRC enforced |
| Degraded decode | Truncated payload reports "863 of 1024 arrived", and **every surviving sample matches the intact decode** — the section 3 claim, demonstrated |
| Chart | Returns markup, has a trace, marks the fault gap, **breaks into exactly 2 subpaths at the fault**, all-fault log yields no chart, flat log still renders, minimum-span floor applied |

Two bugs were caught, and it is worth being clear about where each was:

1. **In the harness, not the page.** A test variable named `esc` shadowed the page's `esc()`
   helper at global scope. The page has no such collision.
2. **In the documentation, not the code.** The tests assert
   `header + payload + faults + crc == total` rather than trusting a subtraction, and that
   caught bits/sample figures reported 11–14 % too high in `COMPRESSION-PLAN.md` — the
   container is 20 bytes, not 18, because `fault_count` is present even with zero faults. All
   three documents are corrected; see COMPRESSION-PLAN section 12.9.

The second one is the argument for section 5's insistence on a runtime self-test, generalised:
**a derived number should be computed by the code that produces the artefact, or asserted
against it.** That figure survived three documents because it was only ever re-typed.

### 13.4 Still needs a real browser

Nothing here has run in a browser. JScript exercises the decoder and the chart *generator*, but
not: SVG rendering, CSS theming in either mode, layout on a phone, `hashchange`,
`crypto.subtle`, the clipboard, or Navigation Timing. Phase 0's acceptance criterion — "self-test
passes on desktop **and on the phone**" — is half met. Open the page and confirm the self-test
banner is green before trusting any field result.

---

