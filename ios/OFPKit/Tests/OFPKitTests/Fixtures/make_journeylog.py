#!/usr/bin/env python3
"""Builds a synthetic Air Astana Journey Log PDF for the OFPKit tests.

Reproduces what the reader keys on: a landscape A4 sheet, one BT/ET block per cell
positioned by its own Tm, printed row numbers in the narrow left column of every table,
and the three heading labels that say where each table starts.

The text is drawn through a Type0 font with a ToUnicode CMap — two bytes to the glyph —
because that is how the real document is set, and reading it any other way gives mojibake.

Regenerate with:  python3 make_journeylog.py
"""

import os
import zlib

PAGE_W, PAGE_H = 841.89, 595.28
ROW = 16.56
LEG_TOP, GAP_FUEL, GAP_CREW = 42.81, 5.25, 6.00
BASE = 11.6                      # baseline within a row

LEG_X = [17.28, 28.61, 71.13, 110.81, 150.49, 190.17, 229.85, 269.53, 309.21, 348.89,
         388.57, 428.25, 467.93, 507.61, 547.29, 586.97, 626.65, 666.33, 706.01, 745.69, 785.37]
LEG_KEY = [None, 'date', 'flight', 'acreg', 'dep', 'arr', 'std', 'sta', 'atd', 'ata', 'tkof',
           'tdwn', 'blk', 'ntblk', 'flt', 'to', 'ld', 'ma', 'flalt', 'detail']
LEG_HDR = ['', 'Date', 'Flight', 'Ac.Reg', 'Dep', 'Arr', 'STD', 'STA', 'ATD', 'ATA', 'TKOF',
           'TDWN', 'Blk', 'NtBLK', 'Flt', 'TO', 'LD', 'MA', 'FlAlt', 'DETAIL']

FUEL_X = [17.28, 28.61, 68.29, 107.97, 147.65, 187.33, 227.01, 266.69, 306.37, 346.05, 408.41, 470.76]
FUEL_KEY = [None, 'init', 'uplfw', 'calcramp', 'actramp', 'stdn', 'burn', 'uplfv',
            'fueldisc', 'slip1', 'slip2']
FUEL_HDR = ['', 'Init', 'UplfW', 'Calc Ramp', 'Act Ramp', 'Stdn', 'Burn', 'UplfV',
            'Fuel Disc', 'Slip 1', 'Slip 2']

PL_X = [470.76, 510.44, 550.12, 589.80, 629.48, 669.16, 708.84, 748.52]
PL_KEY = ['adl', 'chl', 'inf', 'cargo', 'mail', 'bag', 'zfw']
PL_HDR = ['ADL', 'CHL', 'INF', 'Cargo', 'Mail', 'BAG', 'ZFW']

CREW_X = [17.28, 28.61, 68.29, 85.30, 198.67, 238.35, 278.03, 317.71, 357.39, 640.82, 660.66]
CREW_KEY = [None, 'staff', 'pos', 'name', 'duty', 'dutytime', 'night', 'alwd', 'remarks', 'leg']
CREW_HDR = ['', 'Staff No', 'POS', 'Name', 'DUTY', 'Duty time', 'Night duty', 'Alwd. time',
            'REMARKS', '']


class Sheet:
    """Collects cells as (x, baseline-from-top, text)."""

    def __init__(self):
        self.cells = []

    def put(self, x, ty, text):
        if text != "":
            self.cells.append((x, ty, str(text)))

    def table(self, xs, keys, headers, top, rows):
        """A heading band, then one numbered row per entry."""
        for c, h in enumerate(headers):
            if h:
                self.put(xs[c] + 1, top + BASE, h)
        for r, row in enumerate(rows):
            y = top + ROW * (1 + r) + BASE
            self.put(xs[0] + 1, y, r + 1)          # the printed row number
            for c, k in enumerate(keys):
                if k and row.get(k):
                    self.put(xs[c] + 1, y, row[k])


def build_sheet():
    s = Sheet()

    # ---- heading, above the leg table ----
    s.put(53.88, 26.0, "Air Astana JSC")
    s.put(156.64, 26.0, "13/08/2026")
    s.put(325.49, 26.0, "Journey Log No./Задание  KC-2026-004417")
    s.put(233.99, 40.0,
          "Captain/KBC: BOZZHANOV R. //FD Crew Minima/Минимум: CAT ")

    legs = [
        {'date': '13AUG', 'flight': 'KC937', 'acreg': 'P4-KDC', 'dep': 'UAAA', 'arr': 'RKSI',
         'std': '01:45', 'sta': '09:05'},
        {'date': '13AUG', 'flight': 'KC938', 'acreg': 'P4-KDC', 'dep': 'RKSI', 'arr': 'UAAA',
         'std': '10:30', 'sta': '16:20'},
        {},                                        # a blank row, still numbered
    ]
    fuel = [
        {'init': '1200', 'uplfw': '28400', 'calcramp': '29647', 'actramp': '29600'},
        {'init': '900', 'uplfw': '27100', 'calcramp': '28200', 'actramp': '28150'},
    ]
    payload = [
        {'adl': '148', 'chl': '6', 'inf': '2', 'cargo': '2400', 'bag': '3100', 'zfw': '116632'},
        {'adl': '151', 'chl': '3', 'inf': '1', 'cargo': '2100', 'bag': '2950', 'zfw': '115980'},
    ]
    crew = [
        {'staff': '10241', 'pos': 'CP', 'name': 'BOZZHANOV R.', 'leg': 'x'},
        {'staff': '10388', 'pos': 'FO', 'name': 'AITBEK S.', 'leg': 'x'},
        {'staff': '20155', 'pos': 'CC', 'name': 'NURLAN A.', 'leg': 'x'},
    ]

    leg_top = LEG_TOP
    s.table(LEG_X, LEG_KEY, LEG_HDR, leg_top, legs)

    leg_bottom = leg_top + ROW * (1 + len(legs))
    fuel_title = leg_bottom + GAP_FUEL
    s.put(LEG_X[0] + 1, fuel_title + BASE, "Fuel/Информация")
    s.put(PL_X[0] + 1, fuel_title + BASE, "PayLoad")

    fuel_head = fuel_title + ROW
    s.table(FUEL_X, FUEL_KEY, FUEL_HDR, fuel_head, fuel)
    # PayLoad shares the same band, to the right of the fuel columns.
    for c, h in enumerate(PL_HDR):
        s.put(PL_X[c] + 1, fuel_head + BASE, h)
    for r, row in enumerate(payload):
        y = fuel_head + ROW * (1 + r) + BASE
        for c, k in enumerate(PL_KEY):
            if row.get(k):
                s.put(PL_X[c] + 1, y, row[k])

    fuel_bottom = fuel_title + ROW * (2 + len(fuel))
    crew_top = fuel_bottom + GAP_CREW
    s.table(CREW_X, CREW_KEY, CREW_HDR, crew_top, crew)
    return s


# ---- Type0 font with a ToUnicode CMap -------------------------------------------------

def build_font(cells):
    chars = sorted({c for _, _, t in cells for c in t})
    gid = {c: i + 1 for i, c in enumerate(chars)}

    entries = "".join("<%04X> <%04X>\n" % (g, ord(c)) for c, g in gid.items())
    cmap = (
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
        "/CMapName /A-H def /CMapType 2 def\n"
        "1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
        "%d beginbfchar\n%s endbfchar\n"
        "endcmap CMapName currentdict /CMap defineresource pop end end\n"
        % (len(gid), entries))
    return gid, cmap.encode("latin-1")


def content_stream(cells, gid):
    out = []
    for x, ty, text in cells:
        codes = "".join("%04X" % gid[c] for c in text)
        y = PAGE_H - ty
        out.append("BT /F1 7.5 Tf 7.5 0 0 7.5 %.2f %.2f Tm <%s> Tj ET" % (x, y, codes))
    return "\n".join(out).encode("latin-1")


def write_pdf(path):
    sheet = build_sheet()
    gid, cmap = build_font(sheet.cells)
    stream = zlib.compress(content_stream(sheet.cells, gid), 6)

    objects = {}

    def add(n, body):
        objects[n] = body

    add(1, b"<</Type/Catalog/Pages 2 0 R>>")
    add(2, b"<</Type/Pages/Count 1/Kids[3 0 R]>>")
    add(3, b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 %.2f %.2f]"
           b"/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>" % (PAGE_W, PAGE_H))
    add(4, b"<</Length %d/Filter/FlateDecode>>\nstream\n" % len(stream) + stream + b"\nendstream")
    add(5, b"<</Type/Font/Subtype/Type0/BaseFont/Calibri/Encoding/Identity-H"
           b"/DescendantFonts[6 0 R]/ToUnicode 7 0 R>>")
    add(6, b"<</Type/Font/Subtype/CIDFontType2/BaseFont/Calibri"
           b"/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>/DW 500>>")
    add(7, b"<</Length %d>>\nstream\n" % len(cmap) + cmap + b"\nendstream")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for n in sorted(objects):
        offsets[n] = len(out)
        out += b"%d 0 obj\n" % n + objects[n] + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for n in sorted(objects):
        out += b"%010d 00000 n \n" % offsets[n]
    out += (b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objects) + 1, xref_at))

    open(path, "wb").write(bytes(out))
    return len(out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    size = write_pdf(os.path.join(here, "synthetic-journeylog.pdf"))
    print("synthetic-journeylog.pdf written, %d bytes" % size)
