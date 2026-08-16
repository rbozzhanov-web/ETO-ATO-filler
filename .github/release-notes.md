The operational flight plan companion as a native iPadOS / iOS app: the same document, the
same arithmetic and the same print colours as the web version, without Safari in the way.

## Installing it

**This build is unsigned**, which is the only thing a public CI can honestly produce —
signing needs a certificate tied to an Apple ID, and one committed to a public repository
would belong to everybody. So the last step happens on your machine, with your own free
Apple ID:

| | What it needs | How long it lasts |
|---|---|---|
| **[Sideloadly](https://sideloadly.io)** | a Mac or a PC, a cable, a free Apple ID | 7 days, then plug in again |
| **[AltStore](https://altstore.io)** | the same, plus AltServer left running | 7 days, refreshed over Wi-Fi |
| **[TrollStore](https://github.com/opa334/TrollStore)** | an iPad on a version it supports | permanent |

Download `OFP-Companion.ipa` below, hand it to one of those, and it installs like any other
app. Building it in Xcode from source works too, and a paid developer account raises the
seven days to a year.

Requires iPadOS or iOS 16.4 or newer. The app never uses the network — the PDF is read and
written on the device.

## Before you rely on it

This has been built and tested, but never yet flown. Load a real plan and check the waypoint
count and the ETO column against the paper before it matters.

Full notes: [ios/README.md](https://github.com/rbozzhanov-web/ETO-ATO-filler/blob/main/ios/README.md).
