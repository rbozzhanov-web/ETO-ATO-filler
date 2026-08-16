# OFP Companion — the native iPadOS / iOS app

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
    Tests/OFPKitTests/         94 tests, and the script that builds their fixtures
```

The split is the point. **OFPKit has no dependency on UIKit, SwiftUI or Core Graphics**, so
it builds and its tests run anywhere there is a Swift toolchain — including Linux and CI —
rather than only on a Mac. The app target is a thin layer of screen on top of it.

---

## Building it

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

**OFPKit is built and tested.** 94 tests cover inflate against zlib at every level, the PDF
engine end to end, all the OFP parsers, the flight arithmetic and the overlay — including a
test that the saved file is byte-identical to the original for its whole original length.
They were run on Linux, where this port was written.

**The SwiftUI layer has not been compiled.** There was no Mac and no iOS SDK available, so
every file was checked for syntax with `swiftc -parse` and reviewed by hand, but not
type-checked against UIKit or SwiftUI. Expect the first Xcode build to want a few small
corrections — a modifier signature, an inference hint. The logic underneath it is the part
that was verified.

The tests run against a synthetic flight plan built by
`OFPKit/Tests/OFPKitTests/Fixtures/make_ofp.py`, which reproduces the structure the parser
keys on: Courier text at fixed coordinates, the four-dot ETO column with its ATO row, dotted
blanks, a flight plan split across a page break, weather pages, and both chart encodings.
Real packages are operational documents and are not in the repository, so **the first thing
worth doing is loading a real plan and checking the waypoint count against the paper.**

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
