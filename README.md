# LIBERO lite Read-Out

The page a phone opens when it taps a LIBERO lite temperature logger. The logger keeps its whole
log on its NFC tag, as a URL:

```
https://kaistein01.github.io/NFCtest/?id=45KP21094K9001#VEwD…
```

- `?id=` is the logger's **Device ID**, 14 characters, shown grouped as `45KP 21094 K9001`. The
  server looks the shipment up by it.
- Everything after `#` is the **log**: compressed readings in Base64URL. The fragment never leaves
  the phone.

**Live page:** https://kaistein01.github.io/NFCtest/

One static file, no dependencies, no network requests after load. The shipment "server" is a
mock inside the page.

## The three tabs

| Tab | Shows |
|---|---|
| **Sending Site** | Device health, the Device ID, the latest temperature, when it was measured, the logging interval |
| **Receiving Site** | An email field and **Confirm Reception**; the shipment's data from the server; max and min with their times. After confirming: the **alarm status** |
| **Details** | The full history chart, CRC verification, bits per sample, the number of samples on the tag, missing readings, when the logger started, user agent, screen, data source and the decoder's self-test |

**Device health** is red when something fails *now* — the logger has stopped (no new reading
for more than two intervals), the log is unreadable, or the latest reading is a sensor fault —
amber for a time problem, and green otherwise.

**Alarm status** is red if any reading between the logger's start and the reception confirmation
lies outside the shipment's limits, green otherwise. Missing readings do not change it; the
Details tab counts and lists them. The limits come from the server, not from the logger.

**Confirm Reception sends nothing.** The mock stores the confirmation in the browser, keyed by
Device ID and the logger's start time, so a new start is a new shipment. The "Reset demo on this
phone" link in Details forgets it.

## Formats

The version byte decides, and it shows in the first four characters of the fragment:

| Fragment starts | Format | Times |
|---|---|---|
| `VEwC` | **v2**: an 18-byte global header, then segments | estimated: the newest reading is taken as "now" |
| `VEwD` | **v3**: the same with a 21-byte header carrying the **start time** (UTC of reading 0) | exact: start + index × interval |

Anything else is rejected by name. Both formats are a ring of self-contained segments: each has
its own first sample index, count and CRC, so a damaged segment costs only itself and the order
on the tag need not be the order in time. Format specs: `../../NFCLOG-64K-PLAN.md` section 13
(v2) and `../../LIBERO-LITE-PLAN.md` section 10 (v3).

## Demo mode

`&demo=1` in the query shows a log as if it were live:

- the newest reading is placed **7 minutes** before the page opened, and every other time counts
  back from it;
- a confirmation is kept only until the page is reloaded, so every tap starts at the same screen;
- Details says "Data source: demo log".

Decoding, checks, statistics and chart are exactly the live code. The logger never writes this
flag.

[`demo/demo-url.txt`](demo/demo-url.txt) is the demo URL: **10,500 readings** at 15 minutes
(109 days), a slow oscillation between 18 and 22 °C — one cycle per 550 readings, so the chart
never aliases — with six sharp spikes up to 29.0 °C that fall back in a staircase, about
±0.1 °C of noise and no missing readings. Format v2, **9 of 17 segments (about half the tag)**,
2.32 bits per reading, 4371 characters. Written to a separate 8 KB NFC tag, it gives a demo that
works without the logger. Decoded by the logger's reference decoder (`tldecode.ps1`) and by this
page to exactly the generated values.

## Self-test

The page checks its decoder on load, in the browser being used: the same 70-sample reference
series as v2 and as v3 must decode exactly, and v3 must carry its start time. If that fails,
no tab shows numbers.

## Tests

```
powershell -ExecutionPolicy Bypass -File tools\run-jstest.ps1
```

`run-jstest.ps1` splices the page's pure sections (S1–S9) straight out of `index.html`, and the
demo URL out of `demo/demo-url.txt`, into `tools/harness.js`, and runs it under Windows' JScript.
What is tested is the source that ships. It also parses the whole page script — so the page must
stay ES3 — and fails if a company name appears in any file of this public repository.

**162 checks**: the reference vectors; every ring case (ordering, gaps, damage, empty and fresh
logs, overflow, truncation, rejections) as v2 and again as v3; the URL; times, the stale and
future thresholds and every "Last Measurement" wording; statistics and the confirmation window;
alarm, health and missing readings; demo mode and the full demo URL; the chart and its options.

## Deployment

GitHub Pages from `main`, `/ (root)`. An empty `.nojekyll` disables Jekyll, so `index.html` is
served byte for byte; do not add YAML front matter. GitHub Pages caches for about ten minutes,
so deploy a page that reads a new format **before** any tag carries it.
