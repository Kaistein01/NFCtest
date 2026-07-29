# nfctest

A single-page probe for measuring **how much URL-fragment payload a phone actually delivers**
when it reads an NFC tag. The payload is carried as a base64 string.

**Live page:** https://kaistein01.github.io/NFCtest/

The fragment (everything after `#`) is never sent to a server, so every limit you hit here is
client-side: the tag, the phone's NFC stack, or the browser's URL handling. That is exactly what
this measures.

## How it works

Open the page with a base64 fragment and it reports the fragment's character count, the **decoded
data byte count**, the alphabet in use, decode status, full URL length, an independent second
reading of the URL length via the Navigation Timing entry, a SHA-256 prefix of the decoded bytes,
and the **last intact position marker**.

The data being encoded is a ruler of 6-byte chunks `NNNNN.` where `NNNNN` is the running byte
count at that chunk's end:

```
00006.00012.00018.00024. …
```

Base64 maps 4 characters onto 3 bytes, so a fragment truncated anywhere still decodes cleanly up
to its last whole group, and the tail of the decoded ruler then states its own surviving length —
no arithmetic needed. The ruler is non-repeating, so a drop in the middle shows up as a numeric
discontinuity rather than passing unnoticed.

The decoder tolerates missing `=` padding and a truncated trailing group. A leftover single
character cannot encode anything, so it is dropped and reported as
`ok — dropped 1 char to align group`.

### base64url vs standard base64

The generator emits **base64url** (`-` and `_`, unpadded) by default. `+`, `/` and `=` are all
legal in a fragment, but `+` is the classic casualty of anything that form-decodes a string, and
`/` invites path normalization. Since the point of the exercise is to measure the transport, the
alphabet should not be a candidate explanation for a failure. A checkbox switches to standard
base64 if you want to test exactly that.

The reader accepts both automatically and reports which alphabet it saw. Note that ruler data
rarely produces a distinguishing character, so the usual reading is
`ambiguous — no distinguishing char`; that is expected and harmless. `mixed (suspect)` means both
alphabets appeared in one fragment, which points at corruption.

## Budget

| | |
|---|---|
| Base URL `https://kaistein01.github.io/NFCtest/#` | 38 chars |
| On tag, after NDEF URI prefix `0x04` strips `https://` | 30 bytes + ~6 bytes record overhead |
| ST25DV64K capacity | 64 kbit = 8 KB |
| Approx. fragment headroom | ~8100 chars |
| Approx. **data** headroom after base64 expansion (×4/3) | ~6000 bytes |

The tag is not the bottleneck. The phone is.

## Test protocol

1. **Verify the page on a desktop browser first**, before any NFC variable enters. Generate 1500
   data bytes, load the URL, confirm it reads 2000 fragment chars / 1500 decoded bytes and the
   last marker reads `1500`. Edit the fragment in the address bar to confirm the page re-renders
   on `hashchange`. Generate 6000 bytes and confirm the page itself doesn't choke.
2. **Write the tag with ST's NFC Tap / ST25 app.** It sets the extended 8-byte capability container
   with `MLEN` for 8 KB. Generic writers often emit the 4-byte CC and silently cap you at 2 KB.
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

### ST25DV64K gotchas

- Blocks past 255 need the ISO 15693 **Extended** Read Single Block / Read Multiple Block commands.
  A hard ceiling right around 1–2 KB is far more likely to be the writer app or the reader's
  command set than a phone URL limit.
- The chip supports up to 4 protected areas — confirm the NDEF region spans the full memory.
- iOS background (lock-screen) tag reading requires iPhone XS or newer. Older iPhones can read
  Type 5 only from inside an app using Core NFC.

## Results

`userAgent` cannot distinguish an iOS background read from an in-app read — fill the read-path
column by hand.

| Phone | OS | Browser | Read path | Requested bytes | Frag chars | Decoded bytes | Status | Last marker | Hash |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Deployment

Static, no build, no dependencies, no network requests after load. GitHub Pages → Deploy from a
branch → `main` / `/ (root)`. `index.html` deliberately has **no YAML front matter**, so Jekyll
copies it byte-for-byte and skips Liquid processing.
