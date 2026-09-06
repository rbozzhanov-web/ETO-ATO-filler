# Share a PDF straight into OFP Companion or Journey Log

iOS does not let an installed web app register as a native Share Sheet
destination. This Shortcut is the local bridge: it accepts a PDF in the Share
Sheet, puts it on the device-only clipboard, then either app imports it with
one deliberate tap. No file is saved to Files, and no byte is uploaded.

The same Shortcut feeds both apps — the "Paste OFP from Shortcut" button on
OFP Companion and the "Paste OFP from Shortcut" button on Journey Log read
the identical clipboard payload, so one Shortcut covers whichever document
you share.

## Make the Shortcut once

In **Shortcuts**, create a shortcut named **Import to OFP Companion** (or any
name you like — the name only matters for finding it in the Share Sheet).

1. Open the shortcut's details. Enable **Show in Share Sheet**.
2. Under *Share Sheet Types*, select **PDFs** only.
3. Add **Base64 Encode**. Feed it the *Shortcut Input* and set *Line Breaks*
   to **None**.
4. Add a **Text** action. Its text must be exactly:
   `OFPVIEWER-PDF-v1:` followed immediately by the magic variable from the
   Base64 action — no spaces and no new line.
5. Add **Copy to Clipboard**. Feed it the Text output and enable **Local
   Only**.
6. Add **Show Notification** with: `Open the app and tap Paste OFP from
   Shortcut.`

## Use it

1. In Mail, Messages, Files, or another app, use **Share** on the PDF.
2. Tap **Import to OFP Companion**.
3. Open OFP Companion or Journey Log from its Home Screen icon.
4. Tap **Paste OFP from Shortcut** and allow paste when iOS asks.

Each app accepts PDFs up to **3 MB** by this route — the normal PDF picker
remains available for larger documents. After a successful import the app
tries to clear the clipboard; the PDF itself is already parsed into the
document by then, so an uncleared clipboard changes nothing.

## Why not the plain Paste button?

Both apps also have a plain **Paste a PDF** button, and a page-wide paste
gesture, for pasting an actual PDF file straight off the clipboard (a Files
attachment, or a Copy on a computer). That works on a Mac, where Safari's
clipboard does expose `application/pdf`. On iPad or iPhone it never does,
however the PDF got onto the clipboard — including from this Shortcut — so
that button is hidden there and the Shortcut path (carrying the PDF as
plain Base64 text, the one clipboard type iOS *does* hand a web page) is
the one that works instead.
