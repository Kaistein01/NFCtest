# nfctest

A single-page tool that does two things from a URL fragment, auto-detecting which:

1. **Decodes a tempcomp v1 temperature log** — the Base64URL string a NUCLEO-L053R8 logger
   emits — and plots it, with the transport and compression properties alongside.
2. **Measures how much URL-fragment payload a phone actually delivers** when it reads an NFC
   tag, using a self-describing ruler payload.

**Live page:** https://kaistein01.github.io/NFCtest/

The fragment (everything after `#`) is never sent to a server, so every limit you hit here is
client-side: the tag, the phone's NFC stack, or the browser's URL handling.

Rebuild rationale and the decisions behind it: [`REBUILD-PLAN.md`](REBUILD-PLAN.md).
Format spec: `../../COMPRESSION-PLAN.md` section 6. Decode procedure: section 8.

## Which mode

A tempcomp v1 blob always begins with the bytes `'T' 'L' 0x01`, which base64-encode to the
literal prefix **`VEwB`**. That is the whole detection rule — anything else is treated as a
ruler payload.

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
transcription. 47 checks: the golden vector, both real logs (sizes, rare-value fingerprints,
fault position and its intact neighbours, bits/sample, ratio, block statistics), five rejection
cases, degraded decode of a truncated payload with every surviving sample matching the intact
decode, and seven chart assertions including fault-breaking and the minimum-span floor.
