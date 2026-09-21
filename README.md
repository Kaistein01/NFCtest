# NFCTest

A single-page tool that does three things from a URL fragment, auto-detecting which:

1. **Decodes a v1 temperature log** — one container, the Base64URL string a NUCLEO-L053R8
   logger emits — and plots it, with the transport and compression properties alongside.
2. **Decodes a v2 cyclic log** — the same samples, but written round and round a fixed set of
   segments on an 8 KB tag, overwriting the oldest when it runs out of room. Adds what the ring
   itself says: which segments are readable, how many samples have been overwritten, and which
   sample is the newest.
3. **Measures how much URL-fragment payload a phone actually delivers** when it reads an NFC
   tag, using a self-describing ruler payload.

**Live page:** https://kaistein01.github.io/NFCtest/

The fragment (everything after `#`) is never sent to a server, so every limit you hit here is
client-side: the tag, the phone's NFC stack, or the browser's URL handling.

Rebuild rationale and the decisions behind it: [`REBUILD-PLAN.md`](REBUILD-PLAN.md).
Format spec: `../../COMPRESSION-PLAN.md` section 6 (v1) and `../../NFCLOG-64K-PLAN.md`
section 13 (v2). Decode procedure: COMPRESSION-PLAN section 8 and NFCLOG-64K-PLAN section 13.4.

## Which mode

The version byte decides, and it is visible in the first four characters:

| Fragment starts | Bytes | Mode |
|---|---|---|
| **`VEwB`** | `'T' 'L' 0x01` | one v1 container |
| **`VEwC`** | `'T' 'L' 0x02` | a v2 cyclic log |
| anything else | — | ruler payload |

## Cyclic buffer mode

A v2 fragment is a global header followed by fixed-size segments, each of which decodes on its
own: its own starting temperature, its own sample count and its own CRC. The writer fills them
in turn and, when the last one is full, goes back to the first and overwrites it.

So **the order on the tag is not the order in time.** Every segment records the sample index it
starts at, and the page sorts by that. Three things follow, and the page reports all three:

- **Overflow is exact, not estimated.** The oldest surviving segment starts at some sample
  index; everything before it has been overwritten, and that index is the count.
- **Damage is contained.** A segment whose CRC fails costs only itself — it is listed as damaged
  and skipped, the others still plot, and the hole shows as a break in the trace rather than
  quietly closing up.
- **The newest sample is named.** The global header also says which segment is open, which is
  cross-checked against the segment indices.

The segment map shows the whole ring at a glance: `#` is being written now, `=` holds data,
`·` is unused, `X` failed its CRC.

## Temperature mode

Give it a `dump` string from the logger and it shows:

- **The chart.** Stepped, because the data is quantised to 0.1 °C and a smooth line would imply
  readings that were never taken. Faults **break** the trace and are marked in red — the line is
  never bridged across missing data. Above 2000 samples it downsamples min/max per pixel
  column, so a one-sample spike cannot vanish. The Y axis is held to a minimum span of 1 °C,
  without which a stable log renders as violent noise.
- **Container:** version, scheme, CRC status, byte breakdown, sample count, interval,
  `first_index`, covered time span.
- **Compression:** two figures, both defined in REBUILD-PLAN section 7 —
  **vs raw int16** (`samples × 2` ÷ blob) and **bits per sample** (payload bits ÷ samples,
  excluding header, fault section and CRC).
- **Data:** min, max, mean, span, fault count and indices.
- **Block coding:** how many blocks chose each option. `zero` means every delta in the block
  was zero. `escape` means a block was too noisy to code and was stored raw — in a normal log
  that is worth investigating.

### When the CRC fails

The banner turns red and nothing is rendered as data. A checkbox then offers to decode anyway.

This is legitimate but diagnostic-only, and the distinction matters:

| | |
|---|---|
| **Truncation** | Recoverable. The header is at the front and the Rice stream is a forward delta chain, so every sample decoded before the cut is *correct*. The page reports "863 of 1024 arrived", which is a truncation measurement in samples. |
| **Corruption** | Not recoverable. A bit-flip also fails the CRC but silently corrupts every subsequent sample in the chain. |

The page cannot tell you which happened. If the payload decodes fully but the CRC still fails,
that points at corruption rather than truncation, and the banner says so.

## Ruler mode — fragment length probe

The payload is a ruler of 6-byte chunks `NNNNN.` where `NNNNN` is the running byte count at
that chunk's end:

```
00006.00012.00018.00024. …
```

Base64 maps 4 characters onto 3 bytes, so a fragment truncated anywhere still decodes cleanly
up to its last whole group, and the tail of the decoded ruler then states its own surviving
length. The ruler is non-repeating, so a drop in the middle shows up as a numeric discontinuity
rather than passing unnoticed.

**This is why the ruler is kept.** A tempcomp payload cannot do it: it is CRC-protected and
delta-coded, so truncation tells you *that* it broke, not how much survived.

### base64url vs standard base64

The generator emits **base64url** (`-` and `_`, unpadded) by default. `+`, `/` and `=` are all
legal in a fragment, but `+` is the classic casualty of anything that form-decodes a string,
and `/` invites path normalization. A checkbox switches to standard base64 to test exactly
that. The reader accepts both and reports which alphabet it saw; ruler data rarely produces a
distinguishing character, so `ambiguous — no distinguishing char` is the usual and harmless
reading. `mixed (suspect)` means both alphabets appeared in one fragment, which points at
corruption.

## Budget

| | |
|---|---|
| Base URL `https://kaistein01.github.io/NFCtest/#` | 38 chars |
| On tag, after NDEF URI prefix `0x04` strips `https://` | 30 bytes + ~6 bytes record overhead |
| ST25DV64K capacity | 64 kbit = 8 KB |
| Approx. fragment headroom | ~8100 chars |
| Approx. **data** headroom after base64 expansion (×4/3) | ~6000 bytes |

The tag is not the bottleneck. The phone is — and compression has moved the operating point a
long way from it. A 1024-sample log is 224–266 fragment characters, about **3 %** of the
headroom, and ~25 ms of tap time. Fragment limits only become load-bearing again if the log
grows to fill the tag: at the measured 1.14–1.90 bits/sample that is roughly 25,000–42,000
samples.

## Self-test

The page checks its own decoder on load, in the browser being used, against an embedded
70-sample reference vector and its known output. The vector exercises every code path: small
deltas, a 32-sample zero-delta run, two faults, both clamp limits, a jump wide enough to force
the escape option, and a negative ramp.

**The same 70 samples are checked twice**, once as a v1 container and once as a one-segment v2
ring. Both are produced by the firmware, which checks them too, so those two strings are the one
place where the encoder and this page have to agree — and the two formats must yield identical
samples.

If that banner is not green, nothing else on the page should be believed.

Three known payloads are one tap away under **Load a known payload** — the golden vector and
two real 1024-sample logs, one containing a fault, all verified byte-for-byte against the
reference decoder. The page has **no encoder**: real payloads come from the logger, and adding
one would put a fifth implementation of the format in the codebase for no benefit.

## Test protocol — fragment limits

1. **Verify the page on a desktop browser first.** Generate 1500 data bytes, load the URL,
   confirm it reads 2000 fragment chars / 1500 decoded bytes and the last marker reads `1500`.
   Edit the fragment in the address bar to confirm it re-renders on `hashchange`. Generate 6000
   bytes and confirm the page itself doesn't choke.
2. **Write the tag with ST's NFC Tap / ST25 app.** It sets the extended 8-byte capability
   container with `MLEN` for 8 KB. Generic writers often emit the 4-byte CC and silently cap
   you at 2 KB.
3. **Read the tag back with a second app** before trusting any result.
4. **Ladder** (data bytes → resulting fragment chars):
   375→500, 750→1000, 1500→2000, 2250→3000, 3000→4000, 4500→6000, 6000→8000.
   On the first failure, binary-search between the last pass and the first fail.
5. Tap "Copy report row" after each read and paste into the table below (tab-separated).

### Reading the failures

| Symptom | Meaning |
|---|---|
| Decoded bytes < requested | Phone/browser truncated the URL. The last marker gives the exact surviving data length; fragment chars gives the URL-level cap. |
| Page doesn't load at all | The NFC dispatch layer rejected the URL before handing it to a browser — a separate limit; record it separately. |
| `contains non-base64 characters` | Something rewrote the fragment rather than merely cutting it. Check the alphabet row. |
| `mixed (suspect)` alphabet | Corruption, not truncation. |
| Nothing reads | Tag / CC / command-set problem, not a phone limit. Back to step 2. |
| Navigation-entry length ≠ full URL length | Truncation happened in the navigation layer rather than at the tag. |
| Self-test banner red | The decoder is wrong in this browser. Stop and report it — no other result means anything. |

### ST25DV64K gotchas

- Blocks past 255 need the ISO 15693 **Extended** Read Single Block / Read Multiple Block
  commands. A hard ceiling right around 1–2 KB is far more likely to be the writer app or the
  reader's command set than a phone URL limit.
- The chip supports up to 4 protected areas — confirm the NDEF region spans the full memory.
- iOS background (lock-screen) tag reading requires iPhone XS or newer. Older iPhones can read
  Type 5 only from inside an app using Core NFC.

## Results

`userAgent` cannot distinguish an iOS background read from an in-app read — fill the read-path
column by hand.

| Phone | OS | Browser | Read path | Mode | Requested bytes | Frag chars | Decoded bytes | Status | Samples | Marker | Hash |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

## Deployment

Static, no build, no dependencies, no network requests after load. GitHub Pages → Deploy from a
branch → `main` / `/ (root)`.

An empty `.nojekyll` disables Jekyll for the repository, so `index.html` is copied byte-for-byte
regardless of its contents. Before it was added, the file survived only because it happened to
have no YAML front matter — an invisible invariant that a future edit could break silently.

## Verification

The decoder is spliced out of `index.html` and run under Windows' JScript engine by
`run-jstest.ps1` in the session scratchpad — so what is tested is the source that ships, not a
transcription. **78 checks.**

**v1, 47 checks:** the golden vector, both real logs (sizes, rare-value fingerprints, fault
position and its intact neighbours, bits/sample, ratio, block statistics), five rejection cases,
degraded decode of a truncated payload with every surviving sample matching the intact decode,
and seven chart assertions including fault-breaking and the minimum-span floor.

**v2, 31 checks.** The reference vector first: the same 70 samples the v1 vector carries, but as
a one-segment ring, and it must decode to **exactly the same values** — if the two disagree, one
of the two decoders is wrong. Then rings built inside the harness by copying that real segment
and restamping its header, which covers what a single vector cannot:

- two segments joining into one series, and slots **out of order in time**;
- a **gap** between segments: counted, sized, and broken in the chart rather than closed up;
- a **damaged segment** skipped while its neighbours still decode, and the all-damaged case
  rejected;
- an **unused segment** (count 0) skipped;
- **overflow** derived from the oldest surviving index, and the newest sample named;
- a **fragment cut mid-segment**, keeping every whole segment before the cut;
- rejections: bad global CRC, unknown version, segment size that is not a multiple of 3.

**Against real hardware.** The 8116-character fragment produced by the firmware's ring test —
17 segments, wrapped, 430 samples overwritten — was read back off the tag and decoded by this
page's own parser: 3431 samples, 7 faults, **every one identical to what the board echoed as it
logged them**.
