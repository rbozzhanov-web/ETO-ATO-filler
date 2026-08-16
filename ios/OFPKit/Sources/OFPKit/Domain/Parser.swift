import Foundation

/// Reads an Air Astana operational flight plan.
///
/// The document carries no structure worth the name — it is a fixed-pitch listing meant for
/// a printer — so everything is recovered from where the glyphs sit. The ETO column is
/// found by its four dots, the waypoint rows by the pairing of an ETO line with the ATO
/// line twelve points beneath it, and the document blanks by their runs of dots.
public enum OFPParser {

    private static let integer = Pattern("^\\d+$")
    private static let hoursDot = Pattern("^\\d+\\.\\d\\d$")
    private static let picBlock = Pattern("^PIC BLOCK$", caseInsensitive: true)
    private static let plainNumber = Pattern("^\\d{3,6}$")

    public static func parse(_ document: PDFMiniDocument) throws -> ParsedPlan {
        let pages = document.pages()

        var dotRows: [(page: Int, base: Double, size: Double, cw: Double, x: Double,
                       font: String?, tokens: [String])] = []
        var headers: [ColumnHeader] = []
        var rawSegments: [FieldSegment] = []
        var rawLabels: [(label: String, rowLabel: String, reference: String?)] = []
        var page0: [FormLine] = []
        var allLines: [TextLine] = []
        var charts: [ChartPage] = []
        var anchor = 0.0

        for (pageIndex, page) in pages.enumerated() {
            let items = PDFText.items(in: (try? document.content(of: page)) ?? [])
            let font = courierResourceName(document, page)
            detectChart(document, page: page, index: pageIndex,
                        textCount: items.count, into: &charts)

            // Glyphs grouped into lines by baseline, to the nearest half point.
            var byLine: [Double: [Glyph]] = [:]
            for item in items {
                guard item.size >= 9, item.size <= 13 else { continue }
                let key = (item.y * 2).rounded() / 2
                var glyphs = byLine[key] ?? []
                for (i, byte) in item.bytes.enumerated() where byte != UInt8(ascii: " ") {
                    glyphs.append(Glyph(ch: byte, x: item.x + Double(i) * item.cw,
                                        base: item.y, size: item.size, cw: item.cw))
                }
                byLine[key] = glyphs
            }

            for key in byLine.keys.sorted(by: >) {
                var glyphs = byLine[key]!
                glyphs.sort { $0.x < $1.x }
                guard let last = glyphs.last else { continue }
                let cw = last.cw

                if pageIndex == 0 {
                    page0.append(FormLine(base: last.base, glyphs: glyphs, cw: cw,
                                          maxX: last.x + cw, size: last.size))

                    let runs = FormGeometry.dotFields(glyphs, cw: cw)
                    for (k, run) in runs.runs.enumerated() {
                        rawSegments.append(FieldSegment(
                            page: pageIndex, base: last.base, x: run.x, n: run.n,
                            size: last.size, cw: cw, font: font))
                        // The form prints the planned block fuel just left of the PIC BLOCK
                        // blank — "BLOCK FUEL 06.49 29647 PIC BLOCK: ......". Kept for
                        // reference only; the whole-number test skips the block time,
                        // which carries a dot.
                        let reference = picBlock.matches(run.label)
                            ? run.preceding.last(where: { plainNumber.matches($0) })
                            : nil
                        rawLabels.append((label: run.label,
                                          rowLabel: k == 0 ? runs.rowLabel : "",
                                          reference: reference))
                    }
                }

                let tokens = FormGeometry.tokenize(glyphs[...], cw: cw)
                allLines.append(TextLine(page: pageIndex, base: last.base,
                                         text: tokens.joined(separator: " ")))

                if tokens.last == "ATO", last.x > 460, last.x < 540 {
                    headers.append(ColumnHeader(page: pageIndex, base: last.base,
                                                size: last.size, cw: cw, font: font))
                    continue
                }

                // The ETO column: exactly four evenly spaced dots in the right place.
                let dots = glyphs.filter { $0.ch == UInt8(ascii: ".") && $0.x > 440 && $0.x < 540 }
                guard dots.count == 4 else { continue }
                var evenlySpaced = true
                for i in 1..<4 where abs(dots[i].x - dots[0].x - cw * Double(i)) > 0.8 {
                    evenlySpaced = false
                }
                guard evenlySpaced else { continue }

                anchor = max(anchor, dots[0].x + 4 * cw)
                let before = glyphs.filter { $0.x < dots[0].x - 3 }
                dotRows.append((page: pageIndex, base: dots[0].base, size: dots[0].size,
                                cw: cw, x: dots[0].x, font: font,
                                tokens: FormGeometry.tokenize(before[...], cw: cw)))
            }
        }

        // A run with no label of its own continues the field above it.
        let order = (0..<rawSegments.count).sorted { a, b in
            if rawSegments[a].base != rawSegments[b].base {
                return rawSegments[a].base > rawSegments[b].base
            }
            return rawSegments[a].x < rawSegments[b].x
        }
        var fields: [DocumentField] = []
        var sortedSegments: [FieldSegment] = []
        for index in order {
            let segment = rawSegments[index]
            let info = rawLabels[index]
            sortedSegments.append(segment)
            if info.label.isEmpty, !fields.isEmpty {
                fields[fields.count - 1].segments.append(segment)
                fields[fields.count - 1].capacity += segment.n
                continue
            }
            fields.append(DocumentField(
                index: fields.count, label: info.label, rowLabel: info.rowLabel,
                capacity: segment.n, reference: info.reference, segments: [segment]))
        }

        // Sorted before growing so that two lines sharing a baseline resolve the same way
        // every time; the browser version left this to hash order.
        page0.sort { $0.base > $1.base }
        FormGeometry.grow(&fields, rawSegments: sortedSegments, page0: page0)

        let times = readFlightTimes(page0)
        let waypoints = try readWaypoints(dotRows)

        allLines.sort { $0.page != $1.page ? $0.page < $1.page : $0.base > $1.base }
        let icao = IcaoPlanReader.read(allLines)

        return ParsedPlan(
            waypoints: waypoints,
            headers: headers,
            anchor: anchor,
            fields: fields,
            times: times,
            icao: icao,
            charts: charts,
            identity: Identity.ofpIdentity(allLines),
            figures: Identity.keyFigures(allLines),
            airports: WeatherReader.read(allLines, icao: icao))
    }

    // MARK: - Waypoints

    private static func readWaypoints(
        _ rows: [(page: Int, base: Double, size: Double, cw: Double, x: Double,
                  font: String?, tokens: [String])]
    ) throws -> [Waypoint] {

        let sorted = rows.sorted {
            $0.page != $1.page ? $0.page < $1.page : $0.base > $1.base
        }
        var out: [Waypoint] = []
        var cumulative = 0
        var previousTotal = -1
        var section = 1

        var i = 0
        while i < sorted.count {
            let upper = sorted[i]
            guard i + 1 < sorted.count else { i += 1; continue }
            let lower = sorted[i + 1]

            // The ATO line sits one line — twelve points — under the ETO line.
            guard lower.page == upper.page, abs(upper.base - lower.base - 12) <= 2,
                  upper.tokens.count >= 3, lower.tokens.count >= 3 else { i += 1; continue }

            let et = upper.tokens[upper.tokens.count - 2]
            let total = lower.tokens[lower.tokens.count - 2]
            let remaining = lower.tokens[lower.tokens.count - 1]
            guard integer.matches(et), hoursDot.matches(total) else { i += 1; continue }

            let parts = total.split(separator: ".")
            let totalMinutes = (Int(parts[0]) ?? 0) * 60 + (Int(parts[1]) ?? 0)
            // The running total going backwards is where the alternate route restarts.
            if totalMinutes < previousTotal {
                section += 1
                cumulative = 0
            }
            previousTotal = totalMinutes
            cumulative += Int(et) ?? 0

            out.append(Waypoint(
                index: out.count,
                name: upper.tokens[0],
                et: Int(et) ?? 0,
                cum: cumulative,
                section: section,
                page: upper.page,
                etoX: upper.x, etoY: upper.base,
                atoX: lower.x, atoY: lower.base,
                size: upper.size, cw: upper.cw, font: upper.font,
                remaining: integer.matches(remaining) ? Int(remaining) : nil,
                drift: cumulative != totalMinutes))
            i += 2
        }

        guard !out.isEmpty else { throw ParseError.noEtoColumn }
        guard !out.contains(where: { $0.font == nil }) else { throw ParseError.noCourierFont }
        return out
    }

    // MARK: - Flight times

    private static func readFlightTimes(_ page0: [FormLine]) -> FlightTimes? {
        let wanted = ["STD", "ETD", "STA", "ETA"]
        let fourDigits = Pattern("^\\d{4}$")
        var result: FlightTimes?

        let lines = page0.sorted { $0.base > $1.base }
        for i in lines.indices {
            if result != nil { break }
            let heading = FormGeometry.tokensWithX(lines[i].glyphs[...], cw: lines[i].cw)
            var columns: [String: Double] = [:]
            for token in heading where wanted.contains(token.text) {
                columns[token.text] = token.centre
            }
            guard columns.count == 4 else { continue }

            for j in (i + 1)..<min(i + 4, lines.count) {
                let row = FormGeometry.tokensWithX(lines[j].glyphs[...], cw: lines[j].cw)
                // The value under a heading is the nearest four-figure token to its centre.
                func pick(_ centre: Double) -> String? {
                    var best: String?
                    var bestDistance = Double.greatestFiniteMagnitude
                    for token in row where fourDigits.matches(token.text) {
                        let d = abs(token.centre - centre)
                        if d < bestDistance { bestDistance = d; best = token.text }
                    }
                    return bestDistance < 24 ? best : nil
                }
                var candidate = FlightTimes()
                candidate.std = pick(columns["STD"]!)
                candidate.etd = pick(columns["ETD"]!)
                candidate.sta = pick(columns["STA"]!)
                candidate.eta = pick(columns["ETA"]!)
                if candidate.etd != nil { result = candidate; break }
            }
        }

        // Trip time, from the fuel block a few lines down: "TRIP 05.10 23051".
        if result != nil {
            for line in lines {
                let tokens = FormGeometry.tokenize(line.glyphs[...], cw: line.cw)
                if tokens.first == "TRIP", tokens.count > 1,
                   Pattern("^\\d{1,2}\\.\\d{2}$").matches(tokens[1]) {
                    result?.trip = tokens[1]
                    break
                }
            }
        }
        return result
    }

    // MARK: - Resources

    /// The page's resource name for plain Courier — the face the form itself is set in.
    private static func courierResourceName(_ document: PDFMiniDocument, _ page: PDFPage) -> String? {
        guard let fonts = document.resolve(page.resources?["Font"])?.dictValue else { return nil }
        for key in fonts.keys.sorted() {
            guard let font = document.resolve(fonts[key])?.dictValue,
                  let base = font["BaseFont"]?.nameValue else { continue }
            if base.caseInsensitiveCompare("Courier") == .orderedSame { return key }
        }
        return nil
    }

    /// The wind-component and significant-weather sheets are the only pages whose whole
    /// content is one large picture: no body text beyond the header and footer, and a
    /// single image XObject. The scanned paperwork at the back carries three layers and is
    /// left out by the same test.
    private static func detectChart(_ document: PDFMiniDocument, page: PDFPage, index: Int,
                                    textCount: Int, into out: inout [ChartPage]) {
        guard textCount <= 4 else { return }
        guard let xobjects = document.resolve(page.resources?["XObject"])?.dictValue,
              xobjects.count == 1, let key = xobjects.keys.first,
              let stream = document.resolve(xobjects[key])?.streamValue,
              document.resolve(stream.dict["Subtype"])?.nameValue == "Image",
              let width = document.resolve(stream.dict["Width"])?.intValue,
              let height = document.resolve(stream.dict["Height"])?.intValue,
              width >= 600, height >= 400 else { return }
        out.append(ChartPage(page: index, key: key, width: width, height: height))
    }
}
