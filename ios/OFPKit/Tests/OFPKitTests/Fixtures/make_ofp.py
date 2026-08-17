#!/usr/bin/env python3
"""Builds a synthetic Air Astana-shaped OFP PDF for the OFPKit tests.

The real packages cannot go in the repository — they are operational documents — so this
reproduces the structure the parser actually keys on: Courier text at fixed coordinates, a
four-dot ETO column with the ATO row beneath it, dotted document blanks, the ICAO flight
plan between its two markers, METAR/TAF/NOTAM pages, and a full-page chart image. Written
with a classic xref table and FlateDecode streams, which is the shape the engine supports.

Regenerate with:  python3 make_ofp.py
"""

import zlib
import os

CW = 5.4                 # Courier at 9 pt: 0.6 em
SIZE = 9.0
LINE = 12.05
PAGE_W, PAGE_H = 612, 792


def esc(t):
    return t.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


class Page:
    def __init__(self):
        self.ops = []
        self.images = {}

    def text(self, x, y, s, size=SIZE, font="F1"):
        self.ops.append(
            "BT /%s %.2f Tf %.3f %.3f Td (%s) Tj ET" % (font, size, x, y, esc(s)))
        return self

    def line(self, y, s, x=30.0):
        return self.text(x, y, s)

    def image(self, name, w, h, data, colorspace, extra=""):
        self.images[name] = (w, h, data, colorspace, extra)
        self.ops.append("q %d 0 0 %d 20 40 cm /%s Do Q" % (PAGE_W - 40, PAGE_H - 80, name))
        return self

    def content(self):
        return "\n".join(self.ops).encode("latin-1")


def col(n):
    """x of column n, counting Courier cells from the left margin."""
    return 30.0 + n * CW


def build_pages():
    pages = []

    # ---- page 1: identity, weights, the fuel block, the document blanks -------------
    p = Page()
    y = 750.0
    p.line(y, "AIR ASTANA BRIEF"); y -= LINE
    p.line(y, "ROUTE ID: ALAICN01   GENERATED: 13/08/2026 15:26 GMT  --- REQUEST # 83104 ---"); y -= LINE
    p.line(y, "MTOW 187000 MLW 145000 MZFW 134000 MPLD 25000"); y -= LINE
    p.line(y, "TOW 145979 LW 122928 ZFW 116632 PLD 22500 BLKF 29647 DOI 46.59"); y -= LINE * 2

    # STD/ETD/STA/ETA header and its value row, matched by column centre.
    p.text(col(10), y, "STD"); p.text(col(20), y, "ETD")
    p.text(col(30), y, "STA"); p.text(col(40), y, "ETA")
    y -= LINE
    p.text(col(10), y, "0145"); p.text(col(20), y, "0155")
    p.text(col(30), y, "0905"); p.text(col(40), y, "0915")
    y -= LINE
    p.line(y, "FLIGHT KC937  A321  CI027  UAAA-RKSI"); y -= LINE * 2

    p.line(y, "TRIP 05.10 23051"); y -= LINE
    p.line(y, "BLOCK FUEL 06.49 29647 PIC BLOCK: " + "." * 6); y -= LINE * 2

    p.line(y, "ATIS: " + "." * 20); y -= LINE
    p.line(y, "ATC CLRNC: " + "." * 13); y -= LINE          # grows right and onto the line below
    y -= LINE                                               # deliberately blank: the spare line
    p.text(col(0), y, "ALTM1 " + "." * 5)
    p.text(col(20), y, "STBY " + "." * 5)
    p.text(col(40), y, "ALTM2 " + "." * 5)
    y -= LINE
    p.line(y, "REASON FOR EXTRA FUEL: " + "." * 13); y -= LINE
    y -= LINE
    p.line(30.0, "PAGE 1 OF 5")
    pages.append(p)

    # ---- pages 2-3: the waypoint table ----------------------------------------------
    # Each waypoint is two lines with the four dots of the ETO and ATO columns at x 470.
    # The parser reads the leg time as the second-to-last token before the dots on the
    # upper line, and the running total and planned fuel as the last two on the lower one,
    # so both lines carry the trailing columns the real form prints.
    #
    # Sections 1 and 2 are told apart by the running total going backwards, which is what
    # happens where the alternate route restarts from the destination.
    main = [
        ("ALMATY", 0, 0), ("TOKPA", 12, 12), ("USOLA", 9, 21), ("BALKH", 14, 35),
        ("SAKMU", 11, 46), ("URUMQ", 18, 64), ("TOLMA", 16, 80), ("HOTAN", 13, 93),
        ("LANZH", 21, 114), ("XIANN", 17, 131), ("ZHENG", 15, 146), ("QINGD", 19, 165),
        ("WEIHA", 12, 177), ("INCHE", 14, 191), ("RKSI", 10, 201),
    ]
    alternate = [("RKSICF", 0, 0), ("GIMPO", 11, 11), ("RKSS", 8, 19)]
    route = [(n, e, c, 1) for n, e, c in main] + [(n, e, c, 2) for n, e, c in alternate]

    dotx = 470.0
    per_page = 8
    for chunk_no in range(0, len(route), per_page):
        chunk = route[chunk_no:chunk_no + per_page]
        p = Page()
        y = 750.0
        p.line(y, "AIR ASTANA BRIEF"); y -= LINE
        # The ATO column heading: the parser wants "ATO" as the last token, x in 460..540.
        p.text(dotx, y, "ETO ATO"); y -= LINE * 2
        for name, et, cum, sec in chunk:
            rem = (29647 if sec == 1 else 8200) - cum * 95
            tt = "%d.%02d" % (cum // 60, cum % 60)
            dist = 60 + et * 8
            # Upper line: waypoint, airway, position, level, wind, temp, ET, distance.
            p.text(col(0), y, name)
            p.text(col(12), y, "UL551")
            p.text(col(20), y, "N4327E07712")
            p.text(col(34), y, "340")
            p.text(col(40), y, "270/045")
            p.text(col(50), y, "M52")
            p.text(dotx - 14 * CW, y, "%d" % et)
            p.text(dotx - 8 * CW, y, "%d" % dist)
            p.text(dotx, y, "....")
            y -= LINE
            # Lower line: ground speed, running total, planned fuel remaining.
            p.text(col(40), y, "GS480")
            p.text(dotx - 14 * CW, y, tt)
            p.text(dotx - 8 * CW, y, "%d" % rem)
            p.text(dotx, y, "....")
            y -= LINE * 1.5
        p.line(40.0, "PAGE %d OF 8" % (2 + chunk_no // per_page))
        pages.append(p)

    # ---- page 4: ICAO flight plan, split so the reassembly is exercised --------------
    p = Page()
    y = 750.0
    p.line(y, "AIR ASTANA BRIEF"); y -= LINE
    p.line(y, "--- START OF ICAO FLIGHT PLAN ---"); y -= LINE
    for t in ["(FPL-KC937-IS", "-A321/M-SDE2E3FGHIRWXY/LB1",
              "-UAAA0155", "-N0456F340 TOKPA UL551 USOLA"]:
        p.line(y, t); y -= LINE
    p.line(40.0, "PAGE 5 OF 8")
    pages.append(p)

    p = Page()
    y = 750.0
    p.line(y, "AIR ASTANA BRIEF"); y -= LINE
    p.line(y, "PAGE 6 OF 8"); y -= LINE
    for t in ["-RKSI0710 RKSS RKPC", "-EET/ZLHW0132 ZBPE0304 RKRR0621 RALT/ZBAA",
              "REG/P4KDC SEL/AKCP)"]:
        p.line(y, t); y -= LINE
    p.line(y, "--- END OF ICAO FLIGHT PLAN ---"); y -= LINE * 2

    # Weather and NOTAMs, in the layout the parser keys off.
    for t in [
        "DEPARTURE: ALMATY INTL",
        "UAAA ALA RWY05L 4500M ASPH",
        "METAR UAAA 130800Z 27004MPS 9999 SCT040 24/09 Q1016 NOSIG=",
        "TAF UAAA 130500Z 1306/1406 27005MPS 9999 SCT040",
        "TEMPO 1312/1318 -TSRA BKN030CB=",
        "ILS III",
        "- UAAA A3725/26 30JUN0500-30SEP0500",
        "RWY 05L/23R ILS CAT III NOT AVBL DUE MAINT",
        "- UAAA A4947/26 01AUG0000-31AUG2359 EST",
        "TWY B CLSD",
        "ARRIVAL: INCHEON INTL",
        "RKSI ICN RWY15L 3750M ASPH",
        "METAR RKSI 130800Z 12003KT 9999 FEW030 26/19 Q1010 NOSIG=",
        "TAF RKSI 130500Z 1306/1412 12004KT 9999 SCT030=",
        "- RKSI B1234/26 10AUG0000-10SEP2359",
        "APCH LGT RWY33R U/S",
        "COMPANY NOTAMS",
        "UAAA-00001 Oper: Y 28MAY25/0432",
        "VALID FROM: 28MAY2025 TO: PERM",
        "DE-ICING AVBL ON REQUEST",
        "UAAA-RKSI-00002 Oper: Y 01JUN25/0900",
        "VALID FROM: 01JUN2025 TO: 31DEC2026",
        "ETOPS 120 APPROVED FOR THIS SECTOR",
        "OTHER: TASHKENT",
        "UTTT TAS RWY08L 4000M ASPH",
        "METAR UTTT 130800Z 09003MPS CAVOK 30/06 Q1012 NOSIG=",
    ]:
        p.line(y, t); y -= LINE
    pages.append(p)

    # ---- page 6: a full-page chart, palette-indexed under FlateDecode ---------------
    p = Page()
    w, h = 640, 480
    palette = bytes()
    for i in range(256):
        palette += bytes([i, (i * 3) % 256, 255 - i])
    raw = bytearray()
    for row in range(h):
        for cx in range(w):
            raw.append((row * 2 + cx // 3) % 256)
    p.text(30.0, 770.0, "AIR ASTANA BRIEF")
    p.text(30.0, 20.0, "PAGE 7 OF 8")
    p.image("Im0", w, h, zlib.compress(bytes(raw), 6),
            "[/Indexed /DeviceRGB 255 <%s>]" % palette.hex().upper())
    pages.append(p)

    # ---- page 7: a JPEG chart under DCTDecode ---------------------------------------
    p = Page()
    jpeg = make_jpeg()
    p.text(30.0, 770.0, "AIR ASTANA BRIEF")
    p.text(30.0, 20.0, "PAGE 8 OF 8")
    p.images["Im1"] = (800, 600, jpeg, "/DeviceRGB", "DCT")
    p.ops.append("q %d 0 0 %d 20 40 cm /Im1 Do Q" % (PAGE_W - 40, PAGE_H - 80))
    pages.append(p)

    return pages


def make_jpeg():
    """A tiny baseline JPEG. Only its header has to be real — the test checks that the
    bytes come out of the PDF untouched, not that they decode to a picture."""
    return bytes.fromhex(
        "FFD8FFE000104A46494600010100000100010000"
        "FFDB004300FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        "FFFFFFFFFFFF"
        "FFC00011080258032003012200021101031101"
        "FFC4001F0000010501010101010100000000000000000102030405060708090A0B"
        "FFDA000C03010002110311003F00D2CF20"
        "FFD9")


def write_pdf(path, pages):
    objects = {}          # number -> bytes of the object body
    n = [0]

    def add(body):
        n[0] += 1
        objects[n[0]] = body
        return n[0]

    catalog_num = add(b"")          # 1, filled in later
    pages_num = add(b"")            # 2
    font_num = add(b"<</Type/Font/Subtype/Type1/BaseFont/Courier/Name/F1"
                   b"/Encoding/WinAnsiEncoding>>")

    kids = []
    for page in pages:
        stream = zlib.compress(page.content(), 6)
        content_num = add(b"<</Length %d/Filter/FlateDecode>>\nstream\n" % len(stream)
                          + stream + b"\nendstream")

        xobjects = []
        for name, (w, h, data, cs, extra) in page.images.items():
            if extra == "DCT":
                img = (b"<</Type/XObject/Subtype/Image/Width %d/Height %d"
                       b"/ColorSpace %s/BitsPerComponent 8/Filter/DCTDecode/Length %d>>\n"
                       b"stream\n" % (w, h, cs.encode(), len(data)) + data + b"\nendstream")
            else:
                img = (b"<</Type/XObject/Subtype/Image/Width %d/Height %d"
                       b"/ColorSpace %s/BitsPerComponent 8/Filter/FlateDecode/Length %d>>\n"
                       b"stream\n" % (w, h, cs.encode(), len(data)) + data + b"\nendstream")
            xobjects.append((name, add(img)))

        res = b"<</Font<</F1 %d 0 R>>" % font_num
        if xobjects:
            res += b"/XObject<<" + b"".join(
                b"/%s %d 0 R" % (name.encode(), num) for name, num in xobjects) + b">>"
        res += b">>"

        page_num = add(b"<</Type/Page/Parent %d 0 R/MediaBox[0 0 %d %d]/Resources %s"
                       b"/Contents %d 0 R>>" % (pages_num, PAGE_W, PAGE_H, res, content_num))
        kids.append(page_num)

    objects[pages_num] = (b"<</Type/Pages/Count %d/Kids[%s]>>"
                          % (len(kids), b" ".join(b"%d 0 R" % k for k in kids)))
    objects[catalog_num] = b"<</Type/Catalog/Pages %d 0 R>>" % pages_num

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + objects[num] + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for num in sorted(objects):
        out += b"%010d 00000 n \n" % offsets[num]
    out += (b"trailer\n<</Size %d/Root %d 0 R/ID[<0123456789ABCDEF0123456789ABCDEF>"
            b"<0123456789ABCDEF0123456789ABCDEF>]>>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objects) + 1, catalog_num, xref_at))

    open(path, "wb").write(bytes(out))
    return len(out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    size = write_pdf(os.path.join(here, "synthetic-ofp.pdf"), build_pages())
    print("synthetic-ofp.pdf written, %d bytes" % size)
