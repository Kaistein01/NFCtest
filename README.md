# nfctest

A single-page probe for measuring **how much URL-fragment payload a phone actually delivers**
when it reads an NFC tag.

**Live page:** https://kaistein01.github.io/nfctest/

The fragment (everything after `#`) is never sent to a server, so every limit you hit here is
client-side: the tag, the phone's NFC stack, or the browser's URL handling. That is exactly what
this measures.

## How it works

Open the page with a fragment and it reports the payload's character count, UTF-8 byte count,
full URL length, an independent second reading of the URL length via the Navigation Timing entry,
a SHA-256 prefix, and the **last intact position marker**.

The generator builds filler from 6-character chunks `NNNNN.` where `NNNNN` is the running
character count at that chunk's end:

```
00006.00012.00018.00024. …
```

So a truncated payload states its own surviving length in its last chunk — no arithmetic needed.
The filler is pure `[0-9.]`, which is URL-safe and never percent-encoded, keeping raw length equal
to decoded length so the encoding variable stays isolated. It is also non-repeating, so a drop in
the middle shows up as a numeric discontinuity rather than passing unnoticed.

## Budget

| | |
|---|---|
| Base URL `https://kaistein01.github.io/nfctest/#` | 38 chars |
| On tag, after NDEF URI prefix `0x04` strips `https://` | 30 bytes + ~6 bytes record overhead |
| ST25DV64K capacity | 64 kbit = 8 KB |
| Approx. payload headroom | ~8100 chars |

The tag is not the bottleneck. The phone is.

## Test protocol

1. **Verify the page on a desktop browser first**, before any NFC variable enters. Generate 2000
   chars, load the URL, confirm the count reads 2000 and the last marker reads `01998`. Edit the
   fragment in the address bar to confirm the page re-renders on `hashchange`. Generate 8000 and
   confirm the page itself doesn't choke.
2. **Write the tag with ST's NFC Tap / ST25 app.** It sets the extended 8-byte capability container
   with `MLEN` for 8 KB. Generic writers often emit the 4-byte CC and silently cap you at 2 KB.
3. **Read the tag back with a second app** before trusting any result.
4. **Ladder:** 500 → 1000 → 2000 → 3000 → 4000 → 6000 → 8000. On the first failure, binary-search
   between the last pass and the first fail.
5. Tap "Copy report row" after each read and paste into the table below (tab-separated).

### Reading the failures

| Symptom | Meaning |
|---|---|
| Page loads, count < requested | Phone/browser truncated the URL. The last marker gives the exact cap. |
| Page doesn't load at all | The NFC dispatch layer rejected the URL before handing it to a browser — a separate limit; record it separately. |
| Decoded length shows *malformed* | Cut mid-`%XX` escape. The raw cap is real but usable payload is marginally lower. |
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

| Phone | OS | Browser | Read path | Requested | Chars | Bytes | Last marker | Hash |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Deployment

Static, no build. GitHub Pages → Deploy from a branch → `main` / `/ (root)`.
`index.html` deliberately has **no YAML front matter**, so Jekyll copies it byte-for-byte and
skips Liquid processing. Site config lives in `_config.yml`.
