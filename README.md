# OFP Companion — installing on iPad

The app is fully self-contained: the PDF is parsed and written on the device.
Nothing is uploaded anywhere, and after installation nothing is fetched either.
Everything flies with the radios off.

Requires iPadOS 16.4 or newer (`DecompressionStream` is needed to inflate PDF streams).

> **There is also a native app.** `ios/` holds a Swift rewrite of everything below — the same
> document, the same arithmetic, the same print colours, built as a real iPadOS/iOS app
> rather than a page in Safari. It installs from Xcode instead of from a web address, and it
> can have a plan opened straight into it from Files or Mail. See [`ios/README.md`](ios/README.md).
> This web version is not going anywhere; the two read the same plans and write the same overlay.

---

## Option 1. Home screen icon (recommended)

Behaves like a normal app, and saving the PDF goes through the iOS share sheet.
You need the internet **once**, so Safari can fetch the page and cache it.

Everything required is in the `pwa/` folder:

```
pwa/index.html
pwa/journey-log.html
pwa/sw.js
pwa/manifest.webmanifest
pwa/icon-192.png
pwa/icon-512.png
```

There are two pages: `index.html` is the OFP companion described below, and
`journey-log.html` is the Journey Log form. Each links to the other from its
header, and both are cached, so either can be opened offline.

1. Upload the **contents** of `pwa/` to any https host.
   GitHub Pages is free for public repositories: create a repo, put the files in
   the root, then enable Settings → Pages. Netlify Drop also works — just drag
   the folder onto netlify.com/drop.
2. On the iPad open the address in **Safari** (not Chrome — only Safari offers
   "Add to Home Screen").
3. Share button → **Add to Home Screen** → Add.
4. Turn on airplane mode and launch the icon. If it opens, the offline cache is in place.

To update: upload the new `index.html` and bump the `V` constant in `sw.js`.

Versions are whole numbers while there is something new in them. A release that only fixes
things takes a fractional number instead — 19.1 after 19, 19.1.1 after that — so the number
says at a glance whether anything has changed in how the app is used.

The app then updates itself — there is no need to remove and re-add the icon.

The page is fetched from the network whenever there is one, so a new version is picked up on
the next launch rather than waiting on a service-worker update check. If the network does not
answer within 2.5 seconds the app starts from its cache instead, so a slow link never delays
it, and everything other than the page stays cache-first. Should a replacement worker take
over while the app is open, it reloads only when no plan is loaded; with a document open it
says a new version is ready and leaves it for the next launch, so nothing you have entered
moves under your hands.

Offline it never updates, which means the version you leave the ground with is the version you
fly with.

`OFP-Companion.html` in the archive root and `pwa/index.html` are the same file
under two names, for the two scenarios.

---

## Option 2. A single file in the Files app

No hosting at all. Put `OFP-Companion.html` in iCloud Drive or On My iPad and tap it.

Caveat: iPadOS shows local HTML in a preview view rather than full Safari.
The calculation and the table work, but the share sheet, saving the file and
remembering settings between launches may be unavailable — that is a limitation
of the preview mode, not of the app. If saving does not work, use option 1.

On a computer (macOS/Windows) the same file opens with a double click and works fully.

---

## Using it

1. Load the flight plan PDF. The header then shows the route ID, the request
   number and the release time — `ALAICN01 · REQ 83104 · 13/08/2026 15:26Z` — so
   the document on screen can be checked against the one you were given, with the
   weights and cost index on the line under it — `TOW 145979 · LW 122928 · ZFW
   116632 · PLD 22500 · CI027`.
   The app shows STD / ETD / STA / ETA read from the
   document — with the TRIP time beside them — and displays the ICAO flight plan. Where that plan is printed across
   a page break it is reassembled into one text with the page headers stripped out;
   Copy puts it on the clipboard as a single line.
2. Fill in the document fields: ATIS, ATC CLRNC, ALTM1 / STBY / ALTM2, PIC BLOCK
   and REASON FOR EXTRA FUEL. Free-text fields are not limited to the dots: the
   app also claims the empty space to the right of the blank and the spare line
   underneath, then wraps the text between them on a space. REASON FOR EXTRA FUEL
   grows from 13 to 67 characters this way, ATC CLRNC to 149. The counter under
   each box shows how much room is left.
   PIC BLOCK carries the planned block fuel greyed in brackets at the right of the
   box — `PLANNED BLKF (29647)` — read off the same line of the form, where it is
   printed just left of the blank. It stays visible while you type, so the figure you enter can
   be compared against the planned one, and it is never written into the document.
3. Enter the takeoff (airborne) time in UTC, four digits: `0210`.
   The button next to it fills in the ETD from the plan — but that is off-block
   time and takeoff is normally later, so check it. The **UTC now** clock sits beside
   Calculate on the same row, laid out like the box itself — label above, figure
   below — and ticks from the moment the plan loads, so the time you need in order
   to fill the box is next to the box.
   The card then opens underneath
   into the waypoint table: entering the time and reading what it produces is one
   job, so it is one card.
   Enter actual ATO and remaining fuel per waypoint. Enter jumps to the next
   field. Everything is saved automatically. The clock is shown in gold so it is
   not mistaken for a time read off the plan, and the figures above the table name
   the waypoint you are running to.
   The table follows the clock: passed
   points fade back, the last one passed is shaded and the one you are running to
   is highlighted, and the table brings that row to its middle as the flight moves
   on. Only the table scrolls — the page stays where you left it — and it holds
   still for twenty seconds after you scroll it or type in it. Focus is not what
   stops it: Enter steps from one box to the next, so a box stays focused for the
   rest of the flight.
   The highlight follows the plan rather than your typing, so it stays right when
   the actuals are a few points behind.
   Watch the **fuel check** figure above the table. Company rule is a fuel check
   on overflying a waypoint, or at least every 30 minutes, and it is watched on
   the waypoint card itself because the record it needs — the fuel column — is
   already there. A check falls due when you actually pass the waypoint it sits on:
   that waypoint's own ATO once you have entered one, the plan's time carried by
   however far the flight is running from it until then — so the figure follows the
   actuals as they go in. It shows when the next check is due, amber as it comes
   up and red once it has passed unrecorded, with a warning above the table; the
   fuel boxes of the window in question are ringed so it is plain where the
   reading goes. Any one of them will do. Saving with a check overdue asks for
   confirmation.
   The windows follow the flight rather than the paper: a waypoint counts towards the
   window it is actually reached in, moved by however far the flight is running from
   plan. A direct that cuts out everything in a half-hour does not cancel that check —
   it is written on the next waypoint overflown instead. Only past the end of the
   flight is a window dropped.
   A figure entered early — before its own thirty minutes are up — starts the next
   thirty from there rather than leaving the next window due on the old half-hour
   mark: overfly a waypoint and record fuel on it, and the clock the company rule
   actually means restarts at that moment, the same as it would on paper.
4. Record the hourly altimeter cross-checks. The app works out which waypoint
   falls on each full hour after takeoff and lists one row per hour; enter
   ALTM1 / STBY / ALTM2 and the reading is printed on the blank line directly
   under that waypoint, so the time is read off the ETO/ATO right above it.
   Each row tracks its own due time against the device clock in UTC and turns
   red once the check is overdue, with a short tone when it first falls due
   (switch it off with the checkbox — the choice is remembered, and tapping the
   clock beside it no longer knocks it off). No check is raised inside the last
   hour before arrival. Saving the PDF with checks still missing asks for
   confirmation first.
5. **Save PDF** → in the iOS share sheet pick "Save to Files", AirDrop, Print,
   or send it to ForeFlight.
6. **Open charts** to page through the wind components and the significant
   weather sheets on their own.

Every digits-only box — takeoff time, ATO and fuel, the altimeter readings, ALTM/STBY/QNH,
PIC BLOCK — opens the app's own numeric keypad instead of Safari's, docked to the bottom the
way a system keyboard is and built to match it: the same 3×4 layout, the same weight, the
same slide. Top right, a chevron and a label play whatever that field's own Return key would
have — **Next** across a run of boxes, **Go** on the takeoff time, **Done** wherever nothing
moves — so filling a column works exactly as it did with the system keyboard raised. Mirrored
opposite it, top left, **Previous** steps back the same way Shift+Return already does with a
keyboard attached; greyed out on the first box of a run, since there is nowhere behind it to go.

It only ever opens for a field the crew actually tapped or navigated into with a keyboard —
Tab, or a hardware keyboard's own Up/Down between fields — since parsing a plan rebuilds
dozens of these boxes at once, and a focus the rebuild itself leaves sitting on one of them is
left alone.

It dismisses the way a system keyboard does too, since `inputmode="none"` keeps the real one
from ever appearing to dismiss on its own: the iPad's own dismiss key, pinned to the keypad's
own bottom-right corner rather than up in the bar with Next and Previous, closes it outright,
whatever the field's own Return key would otherwise have done; a tap anywhere outside both the field and the
keypad closes it as well, and so does a real scroll — one actually dragged or wheeled, never the
keypad's own scroll bringing the field up above it.

The page scrolls plainly. Three attempts to help it along have been made and all three
withdrawn — CSS scroll snapping, then a pull onto the nearest card once your scroll came to
rest, then page-by-page turning. Each was flown with and each got in the way, so where you
stop is where it stays.

The button in the header switches between light and dark themes; the choice is remembered.

## Getting the plan in

Tap the box and pick the file. On the iPad the PDF can also be **dragged out of Files** onto the
page: put Files alongside in Split View or Slide Over, press and hold the plan, and drop it on
the box.

On a computer it can be pasted as well, with **Paste a PDF** or straight into the page. That
button is not shown on the iPad. Safari's clipboard hands a page `text/plain`, `text/html`,
`text/uri-list`, `image/png` and its own `web `-prefixed types — never `application/pdf` — and
the paste event carries no files on iOS, so there is no route to a pasted PDF there however the
page asks.

## If iPadOS closes the app

iPadOS drops background apps when it needs memory. The loaded plan is kept on the device
alongside everything typed into it, so opening the app again brings the same document back
with the takeoff time, the actuals and the altimeter readings already in place — no need to
find the file again. Cross-checks that have already sounded do not sound a second time.
**Reset** is what clears it and returns to an empty drop zone.

## Direct to a waypoint

When ATC shortcuts the route, press **Direct to…** and tap the waypoint you are cleared to. The
waypoints cut out stay where they are, struck through and faded — the order has to keep matching
the paper form, because that is where the ATOs are written — and the target is marked **DCT**.
The live highlight steps over the skipped ones.

They are not gone from the sky, though: the aeroplane still goes past them, so they keep their own
place on the clock. The one you are level with is shaded and marked **ABEAM**, the one after it is
shaded more faintly still, and both are quieter than the live route so the two can never be read
for each other. Undoing the direct takes the marks away with it.

Nothing about this reaches the document and no ETO is rewritten; it only moves the highlight.
The chip in the toolbar undoes it, and each direct remembers exactly which waypoints it cut out,
so undoing one leaves any other alone.

The highlight also follows the **ATO** figures you enter: the most recent one sets how far the
flight is running from the plan, and every later waypoint is judged against that, shown as, for
example, `-12 on plan`. A fuel window left with nothing to overfly after a direct is dropped
rather than sitting red for the rest of the flight.

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

**The TAF group and the NOTAMs the flight actually meets are picked out.** The departure's own
TAF is read for ETD, the destination's and every alternate's for ETA, the en-route alternate's
for the flight's midpoint — a diversion has no better instant to be judged against. FM, BECMG,
TEMPO and PROB30/PROB40 are resolved the way the form prints them: FM replaces the forecast
outright and holds until the next change; BECMG's new conditions stand from the end of its
window until superseded; TEMPO and PROB30/PROB40 are highlighted only for the window printed on
their own line, alongside whichever of those governs at that moment. NOTAMs get the same
treatment against the same instant: one in force when the flight is actually there is ringed in
the list rather than left to be found by reading all of them. An aerodrome named for no role of
its own, or a plan carrying no date of flight, gets no highlight — there is no instant here worth
guessing at.

**NOTAMs about the runway are marked in red, the taxiway in amber** — the same muted status
colours a fuel check already turns on falling due and going overdue, not a traffic light. Read
off the NOTAM's own words, not off a code the package doesn't carry: these packages print NOTAMs
as free text, not the ICAO Q-line that would otherwise classify them (Doc 8126's own Q-code marks
the aerodrome FA, the runway MR, the taxiway MT), so the app matches Doc 8400's own abbreviations
for the same three things instead — RWY, TWY, AD, plural included. A NOTAM naming both the runway
and the taxiway is coloured for the runway.

**The whole aerodrome closed outranks both.** It gets the one saturated fill on the card — the
same red as the Reset button — since it is the more limiting of the two and is worth catching
before the rest of the list is even read. Neither mark reorders the list — a coloured NOTAM sits
exactly where it was, so the order still matches the numbers next to it.

**Highlight what applies now**, beside the aerodrome dropdown, turns all of the above off at
once — the TAF tint, the "flight is in it" NOTAM ring, and the red/amber hazard colours — for
a crew that would rather read the reports plain. It is a device preference, not a per-plan one:
it stays as left however many plans get loaded after it, the same way the theme does.

Everything is read out of the PDF on the device. There is no network request, no account and
no key — the card works in airplane mode like the rest of the app. The reports are therefore
exactly as old as the document: re-brief from the current source before acting on them.

What is not on the card: SIGMETs, runway lengths, and the company NOTAMs that belong to no
aerodrome (ADMIN, RELEASE, EQUIP and the like).

A box that scrolls says so at both ends: a strip and an arrow below while there is more to come,
and the same above while there is more behind. Each clears itself at its own end, and in the
waypoint table the upper one sits under the sticky column headings so it marks the first hidden
row rather than covering the titles.

The strip is solid in the box's own background colour for its full depth before it fades into
the content, so no half-clipped line of text shows in it or under the arrow. The two arrows are
one shape: the upper one is the lower one turned through 180°, rather than two characters left
to whatever the device's fallback font makes of each.

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

# Journey Log — Задание на полет

`journey-log.html` is the second page. It is the paper Journey Log itself, drawn
on screen: the same landscape sheets, the same blue banding, the same column
widths and 16.56pt rows, all measured off the document and laid out in points.
Nothing is a rendering of the PDF — the form is redrawn, so every blank in it is
a box you can type into.

The boxes are tinted, which is the only thing on the page the paper does not
have: the cells you fill in show pale blue, the cells the document was printed
with do not. What you write goes down in blue so it reads apart from the form's
own black.

## Loading the document

A new Journey Log is issued for every duty, so the page starts empty and asks
for one: **Load PDF**, or drop the file anywhere on the page. It is read on the
device and goes nowhere else.

What comes out of it is the document, not a guess at it — the journey log
number, the date and the captain, the legs with their flight numbers and
scheduled times, and the crew with their staff numbers and leg markers. The
sheets, and the number of rows in each of their three tables, are however many
the PDF has: every row of the form prints its own row number, so the tables
announce their own length and the page is built to match.

The document names itself once it is open: its number is across the top of the
sheet, where the paper carries it.

## Filling it in

What tells a box from print is where it came from, not what is in it. A cell the
document arrived with something in reads as print; a cell the document left
blank is a box.

What was printed is locked. The journey log number, the date and the captain
across the top, the flight identity down the left of the leg table and the crew
roster are the document's own record and are shown rather than offered: they
take no tap, raise no keyboard, and the return key steps straight past them.
Nothing you do on the iPad can quietly disagree with the paper.

Everything the document left blank is yours, all the way across. So the spare
rows at the foot of the leg table are open the whole width of the form and a leg
flown but not issued can be written in by hand — date, flight, registration and
all — and it goes down in blue, apart from the legs that came printed.

- **Times take four digits.** `0340` becomes `03:40` when you leave the box —
  in the leg table and in Duty time, Night duty and Alwd. time alike. DUTY is
  left alone, being a code rather than a clock.
- **Digits-only boxes open the app's own numeric keypad**, the same one the OFP
  companion uses and not Safari's — times, fuel and payload figures alike. A box
  filled this way still gets its colon the moment it stops being edited, same as
  one filled by hand.
- **Blk and Flt work themselves out** — Blk from ATD and ATA, Flt from TKOF and
  TDWN, past midnight included. They are set like every other entry, since that
  is what they are. Write your own figure in and the box is yours from then on;
  clear it again and it goes back to following the times.
- **The duty columns carry down.** DUTY, Duty time, Night duty and Alwd. time
  are the same for the whole crew far more often than not, so the captain's row
  has a small **↓** in each of those four columns: it puts that figure on every
  crew member below. Correct anyone afterwards and only that row changes.
- **The return key steps to the next box**, in reading order across the page —
  the one key the on-screen keyboard offers for it. With a keyboard attached,
  Shift+Return goes back and Tab does the same as Return. The numeric keypad's own
  **Previous** arrow plays Shift+Return the same way, greyed out on the first box.
- Fill-in boxes take capitals, as the form is written.
- The captain's signature has no box. It goes on the paper by hand, so the
  space under it is left clear.
- Everything is saved on the device as you type, and is still there next time.
  **Clear entries** takes back what you wrote and leaves the document as it was
  loaded; **Remove log** discards the document itself and returns the load
  screen, which is how the next one is put in.

Where a name or a heading is wider than its column — the device's font is rarely
the Calibri the document was set in — it is set down a little until it fits, so a
column never loses its last character.

## Getting it onto paper

**Print / PDF** puts the sheets out at their true size: A4 landscape, 297 × 210mm,
one sheet per page, with the toolbar and the box tints left off. The browser's
"Save as PDF" therefore gives back the same document with the entries in it.

## Zoom

**Pinch the sheet**, the way any document is handled; **two taps** put it back to
the width of the window. It opens fitted, and where you leave it is where it is
next time. A sheet zoomed past the window is panned rather than lost — the
header keeps its place and the sheets scroll under it, both ways, so every edge
can be reached.

Only the sheet scales. The page itself is held at one size on purpose: were the
browser left to zoom it, a tapped box would jump under the finger as iOS pulled
the keyboard up, and the header would sail off the screen with it.

## Alongside the companion

The chrome is the OFP companion's — the same colours, the same buttons at the
same sizes, the same load card — and light or dark is whatever that page is set
to, since one switch serves both and it lives over there. Only the surround
changes; the sheet stays white, because it is paper.

The header carries a title and its buttons, nothing else, and **OFP Companion**
sits on the same rectangle as the **Journey Log** button on that page — same
place, same size, in landscape and portrait alike. One spot on the glass moves
between the two documents, and neither has to be looked for.

---

## What is inside

No external libraries — no pdf.js, no pdf-lib, no CDN. `journey-log.html` is one
file of plain HTML, CSS and script; it borrows the OFP companion's PDF reader to
find the text and where it sits, then bins each item into the cell its
coordinates land in. The Journey Log's fonts are Type0/Identity-H, so the glyph
numbers are put back into letters through each font's ToUnicode map — that is
what makes the Cyrillic come out as Cyrillic. `index.html` carries its own
minimal PDF engine: it reads text with coordinates out of FlateDecode streams and
appends an overlay through an incremental update, so the original bytes of the
document stay untouched and new content is simply added at the end of the file.

Built for Air Astana plans: unencrypted PDF, classic xref table, uncompressed
objects, Courier font. If the format turns out to be different, the app says so
on load instead of damaging the document.
