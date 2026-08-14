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

To update: upload the new `index.html` and bump the `V` constant in `sw.js`.

The app then updates itself — there is no need to remove and re-add the icon. Open it once
while online: if no plan is loaded it reloads straight into the new version, and if you are
already working on a document it says a new version is ready and leaves it for the next
launch, so nothing you have entered moves under your hands. Offline it never updates, which
means the version you leave the ground with is the version you fly with.

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

1. Load the flight plan PDF. The header then shows the route ID, the request
   number and the release time — `ALAICN01 · REQ 83104 · 13/08/2026 15:26Z` — so
   the document on screen can be checked against the one you were given.
   The app shows STD / ETD / STA / ETA read from the
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
   field. Everything is saved automatically. The figures above the table carry
   the UTC clock, ticking every second and shown in gold so it is not mistaken
   for a time read off the plan, next to the waypoint you are running to.
   The table follows the clock: passed
   points fade back, the last one passed is shaded and the one you are running to
   is highlighted, with the list scrolling itself to keep that row in the middle.
   It follows the plan rather than your typing, so the highlight stays right when
   the actuals are a few points behind; scrolling by hand or tapping into a box
   stops the automatic scrolling for twenty seconds.
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
7. **Open charts** to page through the wind components and the significant
   weather sheets on their own.

The button in the header switches between light and dark themes; the choice is remembered.

## If iPadOS closes the app

iPadOS drops background apps when it needs memory. The loaded plan is kept on the device
alongside everything typed into it, so opening the app again brings the same document back
with the takeoff time, the actuals and the altimeter readings already in place — no need to
find the file again. Cross-checks that have already sounded do not sound a second time.
**Reset** is what clears it and returns to an empty drop zone.

## Weather and NOTAMs

A card at the bottom shows the METAR, TAF and NOTAMs carried by the loaded package. Pick an
aerodrome from the dropdown and its reports are listed: METAR and TAF raw as printed, then
each NOTAM with its number, validity and subject line above the text, then the Air Astana
company NOTAMs. A busy aerodrome runs to eighty-odd NOTAMs, so the list scrolls inside the
card instead of pushing the rest of the page away.

The dropdown holds everything the package covers, in three groups: **this flight** (departure,
destination, alternate and en-route alternate), **areas along the route** (the FIRs from the
`EET/` field), and **other aerodromes**. Roles and areas come from the ICAO flight plan in the
same document; names and IATA codes from the weather pages. A typical Almaty–Incheon package
gives 4 / 6 / 36.

Both the per-aerodrome weather pages and the raw bulletin at the back are read, so aerodromes
listed there as "NO METAR REPORTS FOUND" still get their reports.

Everything is read out of the PDF on the device. There is no network request, no account and
no key — the card works in airplane mode like the rest of the app. The reports are therefore
exactly as old as the document: re-brief from the current source before acting on them.

What is not on the card: SIGMETs, runway lengths, and the company NOTAMs that belong to no
aerodrome (ADMIN, RELEASE, EQUIP and the like).

## Wind components and weather charts

**Open charts** pages through the full-page pictures in the package on their own: the wind
components / tropopause / MORA profile along the route, and the significant weather charts
with the route drawn on them. Arrow keys or Prev / Next move between them, **Zoom** switches
between fitting the whole sheet on screen and full size with scrolling, Escape closes.

A page is taken for a chart when its whole content is one large image and it carries no body
text beyond the header and footer — which is what these sheets are. The scanned paperwork at
the back of the package has three image layers and is left out. A typical Almaty–Incheon
package yields five charts.

The images are pulled straight out of the PDF, so nothing is re-rendered or re-compressed.
Both encodings these packages use are handled: a raw RGB or palette bitmap under
`FlateDecode`, and a plain JPEG under `DCTDecode`. Decoding happens the first time a chart is
opened, not while the plan is loading.

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
