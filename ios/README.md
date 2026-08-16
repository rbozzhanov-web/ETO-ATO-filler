# OFP Companion — the native iPadOS / iOS app

[![iOS app](https://github.com/rbozzhanov-web/ETO-ATO-filler/actions/workflows/ios.yml/badge.svg)](https://github.com/rbozzhanov-web/ETO-ATO-filler/actions/workflows/ios.yml)

A Swift rewrite of the web app in the repository root. Same document, same arithmetic, same
print colours; a real app instead of a page in Safari.

Nothing here replaces the PWA — it is still in the root and still works. The two read the
same flight plans and write the same overlay.

---

## What is where

```
ios/
  OFPCompanion.xcodeproj     the app project — open this
  OFPCompanion/              the SwiftUI layer
    AppModel.swift             all app state in one object
    Theme.swift                the two palettes, carried over from the CSS
    Views/                     one file per card, plus the chart viewer and the guide
    Support/                   the alert tone and the chart image decoder
  OFPCompanion-Info.plist    only the keys Xcode cannot generate
  OFPKit/                    everything that reads and writes the document
    Sources/OFPKit/
      PDF/                     inflate, lexer, document, text extraction, incremental writer
      Domain/                  the OFP parsers — waypoints, fields, weather, charts
      Logic/                   time, progress, checks, the overlay
      State/                   what is saved between launches
    Tests/OFPKitTests/         95 tests, and the scripts that build their fixtures
```

The split is the point. **OFPKit has no dependency on UIKit, SwiftUI or Core Graphics**, so
it builds and its tests run anywhere there is a Swift toolchain — including Linux and CI —
rather than only on a Mac. The app target is a thin layer of screen on top of it.

---

## Installing it

Every push builds the app on a macOS runner and attaches an `.ipa` to the run; a `v*` tag
publishes it as a [release](https://github.com/rbozzhanov-web/ETO-ATO-filler/releases).

**The build is unsigned, and that is not a shortcut — it is the only thing a public CI can
honestly produce.** Signing needs a certificate tied to an Apple ID, and putting one in a
public repository would hand it to anybody. So the last step happens on your machine, with
your own free Apple ID, using one of these:

| | What it needs | How long it lasts |
|---|---|---|
| **[Sideloadly](https://sideloadly.io)** | a Mac or a PC, a cable, a free Apple ID | 7 days, then plug in again |
| **[AltStore](https://altstore.io)** | the same, plus AltServer left running | 7 days, refreshed over Wi-Fi automatically |
| **[TrollStore](https://github.com/opa334/TrollStore)** | an iPad on a version it supports | permanent, no refreshing |
| **Xcode** | a Mac, and the source below | 7 days free, a year with a paid account |

Whichever route: download `OFP-Companion.ipa` from the release, hand it to the tool, and it
installs like any other app. Nothing about the app itself changes — it never reaches the
network either way.

### Why there is no one-tap install

Because Apple does not allow one. Installing without a desktop tool in the way — tapping a
link and having the app appear — needs the `.ipa` signed with a **distribution** certificate,
and those are issued only inside the paid Apple Developer Program ($99/year). A free Apple ID
gets a development certificate: seven days, over a cable, re-signed locally. No amount of CI
changes that; the same wall stands in Xcode on your own Mac.

With a paid account two routes open up, and both can be automated here:

- **Ad-hoc over the air.** A signed build plus a `manifest.plist` served over HTTPS — GitHub
  Pages already hosts the web version and would do. Tap the link in Safari on the iPad and it
  installs. Each device's UDID has to be registered first, up to 100 a year, and the build
  lasts a year with no review.
- **TestFlight.** An invitation link; the tester taps Install. No UDIDs, up to 10,000 testers,
  updates arrive on their own. Builds last 90 days and external testers need a light review.

Neither is written yet — there is no account to write them against. Both are a day's work
once there is one.

---

## Building it yourself

Requires **Xcode 16 or newer** (the project uses synchronized file groups, so new files are
picked up without editing the project) and targets **iOS / iPadOS 16.4**, the same floor the
web version had.

1. `open ios/OFPCompanion.xcodeproj`
2. Select your team under **Signing & Capabilities**. The bundle identifier ships as
   `com.example.ofpcompanion` — change it to your own.
3. Choose your iPad and press Run.

A free Apple ID will sign it for personal use; the build then expires after seven days and
has to be re-installed. A paid developer account lasts a year.

### Running the tests

The whole engine can be exercised without Xcode:

```sh
cd ios/OFPKit
swift test
```

Inside Xcode the same tests run under **Product → Test** once the package is opened.

---

## State of the work

**It builds, and the tests pass.** Every push runs the whole thing on a macOS runner: 95
OFPKit tests, then the app compiled against the real SDK, then an archive. The badge above
is that pipeline.

The 95 tests cover inflate against zlib at every level, the PDF engine end to end, all the
OFP parsers, the flight arithmetic and the overlay — including a test that the saved file is
byte-identical to the original for its whole original length.

**What has not happened is anyone using it.** It has never been run on a real iPad against a
real flight plan. Compiling proves the types line up, not that a column is read off the right
place or that a card is legible in daylight. That part is still ahead.

The tests run against a synthetic flight plan built by
`OFPKit/Tests/OFPKitTests/Fixtures/make_ofp.py`, which reproduces the structure the parser
keys on: Courier text at fixed coordinates, the four-dot ETO column with its ATO row, dotted
blanks, a flight plan split across a page break, weather pages, and both chart encodings.
Real packages are operational documents and are not in the repository, so **the first thing
worth doing is loading a real plan and checking the waypoint count against the paper.**

The port went in having never met a compiler — there was no Mac on the machine it was
written on. The macOS runner found exactly one error in the SwiftUI layer, which is in the
history as the commit after the workflow.

---

## How it differs from the web version

Behaviour is deliberately the same. These are the places where being a real app changes
something:

| | PWA | Native |
|---|---|---|
| Inflating PDF streams | `DecompressionStream` | its own DEFLATE, so nothing is owed to the platform |
| Saving | share sheet via `navigator.share` | the same share sheet, natively |
| Getting the plan in | picker, or dragged from Files | those, plus opening a PDF **into** the app from Files or Mail |
| Surviving eviction | IndexedDB + localStorage | files in Application Support |
| Pasting a PDF | desktop only, impossible on iPad | dropped entirely — it never worked there |
| Charts | decoded to a canvas | decoded to a `CGImage`, off the main thread |
| Updates | new version on next launch | through the App Store or a re-install |

The alert tone sits on the **ambient** audio category, which means the silent switch still
governs it and it mixes with anything else playing rather than interrupting. That matches
what Web Audio did. If it should sound through the silent switch instead, change `.ambient`
to `.playback` in `Support/Alarm.swift` — one line, and a deliberate decision rather than an
accident.

---

## Why the PDF engine was ported rather than replaced

Apple ships PDFKit, and it was not usable here.

The app's whole bargain with the document is that **it never rewrites it**. What the crew
saves is the original file, byte for byte, with an incremental update appended: new objects,
a new cross-reference table, a trailer pointing back at the old one. A reader that chokes on
the new part still has the document that was signed off. `PDFDocument.dataRepresentation()`
serialises the whole file afresh, which throws that away.

The read side needs the same fidelity. The form is a fixed-pitch listing with no structure
worth the name, and every column is found by coordinate — the ETO column by its four dots,
the waypoint rows by the pairing of a line with the one twelve points beneath it, the blanks
by their runs of dots. That needs text with positions and the character width they were set
at, which is a lower level than PDFKit offers.

So the engine is a deliberate port of the browser one, quirk for quirk, and the tests assert
the properties that matter rather than the implementation.

Two bugs turned up in the writing, both on damaged input: a corrupt Huffman code indexed the
symbol table backwards and trapped, and a truncated stream could decode to a silently short
result rather than an error. In the cockpit those are a crash and a half-read plan. Both are
fixed and both have tests.

---

## One behaviour that was corrected rather than copied

The web version does not keep its record of which cross-checks have already sounded across a
restart, although its own documentation says it does. `loadBuffer` restores the set from
storage, and then the recalculation it triggers runs `renderAlt`, which begins by clearing
it — so every check already overdue sounds again the moment the app is reopened. On a long
sector that is several alerts at once, for readings the crew took hours ago.

The native app keeps them. `calculate()` re-arms the alerts, because pressing Calculate means
a new takeoff time and every due time moves with it, but the restore path calls
`calculate(rearmAlerts: false)` and the acknowledged set survives. That is what the web
version's README always described.

Worth carrying back to `index.html` if the two are to stay in step.
