import Foundation

/// Reading the form's geometry: turning a row of glyphs back into words, finding the
/// dotted blanks, and working out how much room each blank really has.
enum FormGeometry {

    /// Words on a line. A gap wider than one and a half character cells ends a word —
    /// the form separates its columns with runs of spaces, which never reach the glyph
    /// list, so the space between words has to be inferred from the coordinates.
    static func tokenize(_ glyphs: ArraySlice<Glyph>, cw: Double) -> [String] {
        var out: [String] = []
        var current: [UInt8] = []
        var previous: Double?

        for g in glyphs {
            if let p = previous, g.x - p > cw * 1.5 {
                if !current.isEmpty { out.append(Latin1.string(current)) }
                current = []
            }
            current.append(g.ch)
            previous = g.x
        }
        if !current.isEmpty { out.append(Latin1.string(current)) }
        return out
    }

    struct PositionedToken {
        let text: String
        let x: Double
        let x1: Double
        var centre: Double { (x + x1) / 2 }
    }

    /// The same split, but keeping where each word starts and ends. Used to match a value
    /// row against its heading by column centre.
    static func tokensWithX(_ glyphs: ArraySlice<Glyph>, cw: Double) -> [PositionedToken] {
        var out: [PositionedToken] = []
        var current: [UInt8] = []
        var x0 = 0.0
        var previous: Double?

        for g in glyphs {
            if let p = previous, g.x - p > cw * 1.5, !current.isEmpty {
                out.append(PositionedToken(text: Latin1.string(current), x: x0, x1: p + cw))
                current = []
            }
            if current.isEmpty { x0 = g.x }
            current.append(g.ch)
            previous = g.x
        }
        if !current.isEmpty, let p = previous {
            out.append(PositionedToken(text: Latin1.string(current), x: x0, x1: p + cw))
        }
        return out
    }

    private static let numericToken = Pattern("^[\\d.,%/+-]+$")
    private static let endsWithColon = Pattern(":$")
    private static let trailingPunctuation = Pattern("[:\\-]+$")

    /// The name of a blank: the words immediately before the dots, stopping at the first
    /// figure — so `BLOCK FUEL 06.49 29647 PIC BLOCK: ......` is called `PIC BLOCK` and not
    /// the whole line. Anything before a colon is dropped as a prefix.
    static func label(from tokens: [String]) -> String {
        var out: [String] = []
        var i = tokens.count - 1
        while i >= 0 && out.count < 4 {
            if numericToken.matches(tokens[i]) { break }
            out.insert(tokens[i], at: 0)
            i -= 1
        }

        var colonIndex = -1
        for (k, s) in out.enumerated() where endsWithColon.matches(s) { colonIndex = k }
        let tail = (colonIndex >= 0 && colonIndex < out.count - 1)
            ? Array(out[(colonIndex + 1)...])
            : out

        var joined = tail.joined(separator: " ")
        if let m = trailingPunctuation.first(joined), let whole = m[0] {
            joined = String(joined.dropLast(whole.count))
        }
        return joined.trimmingCharacters(in: .whitespaces)
    }

    struct DotRun {
        let x: Double
        let n: Int
        let label: String
        /// The words before the run, kept so the planned block fuel can be picked out.
        let preceding: [String]
    }

    struct DotRuns {
        let runs: [DotRun]
        /// A title for the whole row, used when several blanks share one line.
        let rowLabel: String
    }

    /// Blanks on a line: runs of five or more evenly spaced dots.
    static func dotFields(_ glyphs: [Glyph], cw: Double) -> DotRuns {
        var out: [DotRun] = []
        var i = 0
        var lastEnd = 0
        let dot = UInt8(ascii: ".")

        while i < glyphs.count {
            guard glyphs[i].ch == dot else { i += 1; continue }
            var j = i
            while j + 1 < glyphs.count,
                  glyphs[j + 1].ch == dot,
                  abs(glyphs[j + 1].x - glyphs[j].x - cw) < 0.6 {
                j += 1
            }
            let n = j - i + 1
            if n >= 5 {
                let tokens = tokenize(glyphs[lastEnd..<i], cw: cw)
                out.append(DotRun(x: glyphs[i].x, n: n,
                                  label: label(from: tokens), preceding: tokens))
                lastEnd = j + 1
            }
            i = j + 1
        }

        var rowLabel = ""
        if out.count > 1, out[0].preceding.count > 1 {
            rowLabel = label(from: Array(out[0].preceding.dropLast()))
        }
        return DotRuns(runs: out, rowLabel: rowLabel)
    }

    /// Spreads a value over a field's segments, breaking on a space rather than mid-word
    /// when there is a sensible place to break.
    public static func layout(_ value: String, over segments: [FieldSegment]) -> [String] {
        var out: [String] = []
        var rest = Array(value)

        for (k, segment) in segments.enumerated() {
            if rest.isEmpty { out.append(""); continue }

            if rest.count <= segment.n || k == segments.count - 1 {
                out.append(String(rest.prefix(segment.n)))
                rest = Array(rest.dropFirst(segment.n))
                continue
            }

            var cut = segment.n
            // The last space at or before the segment's end, but only if it is far enough
            // in to be worth breaking at — otherwise a long word would leave the line
            // almost empty.
            if let space = rest.prefix(segment.n + 1).lastIndex(of: " "),
               Double(space) > Double(segment.n) * 0.4 {
                cut = space
            }
            var head = String(rest.prefix(cut))
            while head.hasSuffix(" ") { head.removeLast() }
            out.append(head)

            rest = Array(rest.dropFirst(cut))
            while rest.first == " " { rest.removeFirst() }
        }
        return out
    }

    /// Free-text blanks are usually printed far shorter than the room actually available.
    /// This hands each one whatever is empty to the right of it on its own line, and the
    /// spare line underneath when that is free too — which is what takes REASON FOR EXTRA
    /// FUEL from 13 characters to 67, and ATC CLRNC to 149.
    static func grow(_ fields: inout [DocumentField],
                     rawSegments: [FieldSegment],
                     page0: [FormLine]) {
        guard !fields.isEmpty, !page0.isEmpty, let cw = rawSegments.first?.cw, cw > 0 else {
            return
        }

        // The right-hand edge the form itself writes to.
        let rightEdge = rawSegments.map { $0.x + Double($0.n) * cw }.max() ?? 0

        // Line spacing, taken as the smallest plausible gap actually seen on the page.
        let bases = Array(Set(page0.map(\.base))).sorted(by: >)
        var lineHeight = 12.05
        for i in 1..<max(bases.count, 1) {
            let d = bases[i - 1] - bases[i]
            if d > 6 && d < lineHeight + 0.01 { lineHeight = d }
        }

        func line(at y: Double) -> FormLine? {
            page0.first { abs($0.base - y) < 1 }
        }
        var busy = Set(rawSegments.map { Int($0.base.rounded()) })

        // Continuation lines start on the form's own character grid, not part-way through
        // a cell, so the text lines up with everything else printed on the page.
        func snap(_ x: Double) -> Double {
            30 + (((x - 30) / cw) - 0.001).rounded(.up) * cw
        }

        for index in fields.indices {
            // Short numeric boxes — altimeter settings and the like — are left exactly as
            // the form drew them.
            guard fields[index].capacity >= 12 else { continue }
            guard var segment = fields[index].segments.last else { continue }
            let segmentIndex = fields[index].segments.count - 1

            // 1. Nothing to the right on its own line: take that room.
            let end = segment.x + Double(segment.n) * cw
            if let l = line(at: segment.base), end >= l.maxX - 0.5 {
                let extra = Int((rightEdge - end) / cw + 0.001)
                if extra > 0 {
                    segment.n += extra
                    fields[index].capacity += extra
                    fields[index].segments[segmentIndex] = segment
                }
            }

            // 2. The line below is free: continue onto it.
            let nextBase = segment.base - lineHeight
            if busy.contains(Int(nextBase.rounded())) { continue }
            let below = line(at: nextBase)
            let startX = snap(below.map { $0.maxX + 2 * cw } ?? 30)
            let room = Int((rightEdge - startX) / cw + 0.001)
            if room < 12 { continue }

            fields[index].segments.append(FieldSegment(
                page: segment.page, base: nextBase, x: startX, n: room,
                size: segment.size, cw: cw, font: segment.font))
            fields[index].capacity += room
            busy.insert(Int(nextBase.rounded()))
        }
    }
}
