#!/usr/bin/env python3
"""Fixtures for InflateTests: the same bytes at every zlib level, plus the shapes that
exercise stored blocks, both Huffman trees, long back-references and the bare-deflate
variant. Kept small enough to live in the repository.

Regenerate with:  python3 make_inflate_fixtures.py
"""

import os
import random
import zlib

d = os.path.dirname(os.path.abspath(__file__))
random.seed(20260816)


def write(name, plain, comp):
    open(os.path.join(d, name + ".bin"), "wb").write(plain)
    open(os.path.join(d, name + ".z"), "wb").write(comp)


# Text shaped like a real content stream: the actual workload.
cs = b"".join(
    b"BT /F1 9.00 Tf %.2f %.2f Td (WAYPOINT%04d  0.%02d  %05d) Tj ET\n"
    % (30 + i % 500, 700 - (i % 60) * 12, i, i % 60, 20000 + i)
    for i in range(800))
write("contentstream", cs, zlib.compress(cs, 6))

base = (b"AIR ASTANA BRIEF PAGE 1 OF 42\n" * 60
        + bytes(range(256)) * 12
        + b"ETO ATO FUEL DIFF ALTM CHK " * 120)
for level in (0, 1, 6, 9):
    write("level%d" % level, base, zlib.compress(base, level))

rep = b"A" * 20000                      # forces maximum-length back-references
write("repetitive", rep, zlib.compress(rep, 9))

rnd = bytes(random.getrandbits(8) for _ in range(20000))   # incompressible: stored blocks
write("random", rnd, zlib.compress(rnd, 9))

write("empty", b"", zlib.compress(b"", 6))

co = zlib.compressobj(6, zlib.DEFLATED, -15)               # no zlib wrapper
write("rawdeflate", base, co.compress(base) + co.flush())

print("inflate fixtures written")
