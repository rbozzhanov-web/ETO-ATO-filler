# ETO / ATO Filler — installing on iPad

The app is fully self-contained: the PDF is parsed and written on the device.
No network access after installation, nothing is uploaded anywhere.

Requires iPadOS 16.4 or newer (`DecompressionStream` is needed to inflate PDF streams).

---

## Option 1. Home screen icon (recommended)

Behaves like a normal app, and saving the PDF goes through the iOS share sheet.
You need the internet **once**, so Safari can fetch the page and cache it.

Everything required is in the `pwa/` folder:

```
pwa/index.html
pwa/sw.js
pwa/manifest.webmanifest
pwa/icon-192.png
pwa/icon-512.png
```

1. Upload the **contents** of `pwa/` to any https host.
   GitHub Pages is free for public repositories: create a repo, put the files in
   the root, then enable Settings → Pages. Netlify Drop also works — just drag
   the folder onto netlify.com/drop.
2. On the iPad open the address in **Safari** (not Chrome — only Safari offers
   "Add to Home Screen").
3. Share button → **Add to Home Screen** → Add.
4. Turn on airplane mode and launch the icon. If it opens, the offline cache is in place.

To update: upload the new `index.html`, bump the `V` constant in `sw.js`,
then open the app once while online.

`ETO-Filler.html` in the archive root and `pwa/index.html` are the same file
under two names, for the two scenarios.

---

## Option 2. A single file in the Files app

No hosting at all. Put `ETO-Filler.html` in iCloud Drive or On My iPad and tap it.

Caveat: iPadOS shows local HTML in a preview view rather than full Safari.
The calculation and the table work, but the share sheet, saving the file and
remembering settings between launches may be unavailable — that is a limitation
of the preview mode, not of the app. If saving does not work, use option 1.

On a computer (macOS/Windows) the same file opens with a double click and works fully.

---

## Using it

1. Load the flight plan PDF. The app shows STD / ETD / STA / ETA read from the
   document, and displays the ICAO flight plan. Where that plan is printed across
   a page break it is reassembled into one text with the page headers stripped out;
   Copy puts it on the clipboard as a single line.
2. Fill in the document fields: ATIS, ATC CLRNC, ALTM1 / STBY / ALTM2, PIC BLOCK
   and REASON FOR EXTRA FUEL. Free-text fields are not limited to the dots: the
   app also claims the empty space to the right of the blank and the spare line
   underneath, then wraps the text between them on a space. REASON FOR EXTRA FUEL
   grows from 13 to 67 characters this way, ATC CLRNC to 149. The counter under
   each box shows how much room is left.
3. Enter the takeoff (airborne) time in UTC, four digits: `0210`.
   The button next to it fills in the ETD from the plan — but that is off-block
   time and takeoff is normally later, so check it.
4. Enter actual ATO and remaining fuel per waypoint. Enter jumps to the next
   field. Everything is saved automatically.
5. Record the hourly altimeter cross-checks. The app works out which waypoint
   falls on each full hour after takeoff and lists one row per hour; enter
   ALTM1 / STBY / ALTM2 and the reading is printed on the blank line directly
   under that waypoint, so the time is read off the ETO/ATO right above it.
   Each row tracks its own due time against the device clock in UTC and turns
   red once the check is overdue, with a short tone when it first falls due
   (switch it off with the checkbox). Saving the PDF with checks still missing
   asks for confirmation first.
6. **Save PDF** → in the iOS share sheet pick "Save to Files", AirDrop, Print,
   or send it to ForeFlight.

The button in the header switches between light and dark themes; the choice is remembered.

## AI briefing (optional)

When the device is online an extra card appears at the bottom. It sends the loaded plan to a
model and returns a short summary — fuel, times, SIGMET and AIRMET, turbulence, NOTAMs, specials.

Two services are selectable under **API key**:

| Service | Cost | Key from |
|---|---|---|
| Google Gemini (default) | Free tier, rate limited | aistudio.google.com, no card |
| Anthropic Claude | Paid per request | console.anthropic.com, prepaid credit |

Only the key is needed — the app queries the service for the models that key can use and
selects one automatically, preferring the current fast tier over preview models, and re-checks
if the chosen model is ever withdrawn. The key is stored on the device only. **On the Gemini free tier Google may use
what you send to improve their products** — check that sending company flight documentation is
acceptable under your operator's policy. The summary is machine-generated, may be wrong, and
never replaces studying the flight documentation.

## Print colours

Fixed and not configurable, so every document comes out the same:

| Item | Colour |
|---|---|
| ETO | blue |
| ATO | green |
| Fuel and the FUEL column | black |
| Document fields (ATIS, ATC CLRNC and the rest) | blue |
| Hourly ALTM CHK lines | blue |
| DIFF | green above plan, red below |

Everything written is printed in bold Courier-Bold so it stands out from the form's own type.

---

## What is inside

No external libraries — no pdf.js, no pdf-lib, no CDN. `index.html` carries its own
minimal PDF engine: it reads text with coordinates out of FlateDecode streams and
appends an overlay through an incremental update, so the original bytes of the
document stay untouched and new content is simply added at the end of the file.

Built for Air Astana plans: unencrypted PDF, classic xref table, uncompressed
objects, Courier font. If the format turns out to be different, the app says so
on load instead of damaging the document.
