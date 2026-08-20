import Foundation

/// Reads an Air Astana Journey Log.
///
/// The document is read rather than assumed. Every row of every table carries a printed
/// row number in its narrow left column, blank rows included, so the tables announce their
/// own length; the three heading labels say where each one starts. That is what lets a log
/// with two legs and a log with six be drawn from the same code.
public enum JourneyLogReader {

    private static let integerOnly = Pattern("^\\d+$")
    private static let captainLine = Pattern("Captain/\\w+:\\s*([\\s\\S]*?)\\s*//FD")
    private static let docNumberLabel = "^Journey Log No\\./\\S+(\\s+\\S+)*?\\s{2,}"

    public static func parse(_ document: PDFMiniDocument) throws -> [JourneyLogPage] {
        let pages = document.pages()
        guard !pages.isEmpty else { throw JourneyLogError.noPages }

        var out: [JourneyLogPage] = []
        for page in pages {
            let box = page.mediaBox ?? [0, 0, JourneyLogForm.pageWidth, JourneyLogForm.pageHeight]
            let measured = box.count >= 4 ? abs(box[3] - box[1]) : JourneyLogForm.pageHeight
            let height = measured == 0 ? JourneyLogForm.pageHeight : measured
            let fonts = PDFFontReader.fonts(of: page, in: document)
            let items = PDFText.blockItems(in: try document.content(of: page), fonts: fonts)
            out.append(try readPage(items, pageHeight: height))
        }
        return out
    }

    /// One item, with its baseline measured down from the top of the sheet — which is how
    /// the form is laid out and how everything below is expressed.
    private struct Placed {
        let text: String
        let x: Double
        let ty: Double
    }

    static func readPage(_ blocks: [PDFBlockItem], pageHeight: Double) throws -> JourneyLogPage {
        var items = blocks.map { Placed(text: $0.text, x: $0.x, ty: pageHeight - $0.y) }
        items.sort { $0.ty != $1.ty ? $0.ty < $1.ty : $0.x < $1.x }

        func heading(_ text: String) -> Placed? {
            items.first { $0.text.trimmingCharacters(in: .whitespaces) == text }
        }
        guard let legHeading = heading("Date"),
              let fuelHeading = heading("Init"),
              let crewHeading = heading("Staff No") else {
            throw JourneyLogError.notAJourneyLog
        }

        // Every row prints its number in the narrow left column, blank rows included, so
        // the numbers alone give the rows and their baselines.
        let numbers = items.filter {
            $0.x >= 17 && $0.x <= 28
                && integerOnly.matches($0.text.trimmingCharacters(in: .whitespaces))
        }
        func band(from low: Double, to high: Double) -> [Double] {
            var ys: [Double] = []
            for item in numbers {
                guard item.ty > low + 2, item.ty < high - 2 else { continue }
                if !ys.contains(where: { abs($0 - item.ty) < 3 }) { ys.append(item.ty) }
            }
            return ys.sorted()
        }
        let legY = band(from: legHeading.ty, to: fuelHeading.ty)
        let fuelY = band(from: fuelHeading.ty, to: crewHeading.ty)
        let crewY = band(from: crewHeading.ty, to: .greatestFiniteMagnitude)
        guard !legY.isEmpty, !fuelY.isEmpty, !crewY.isEmpty else { throw JourneyLogError.noRows }

        /// Drops each item into the row and column it sits in. A band may be served by more
        /// than one table side by side — fuel and payload share theirs.
        func fill(_ ys: [Double], _ specs: [(xs: [Double], keys: [String?])]) -> [[String: String]] {
            var rows = [[String: String]](repeating: [:], count: ys.count)
            for item in items {
                guard item.x >= 17 else { continue }
                guard let r = ys.firstIndex(where: { abs(item.ty - $0) < 3 }) else { continue }
                for spec in specs {
                    guard let c = JourneyLogForm.column(of: item.x, in: spec.xs),
                          c < spec.keys.count, let key = spec.keys[c] else { continue }
                    rows[r][key] = item.text.trimmingCharacters(in: .whitespaces)
                    break
                }
            }
            return rows
        }

        let payloadKeys: [String?] = JourneyLogForm.payloadKeys.map { $0 }
        let legs = fill(legY, [(JourneyLogForm.legX, JourneyLogForm.legKeys)])
        let both = fill(fuelY, [(JourneyLogForm.fuelX, JourneyLogForm.fuelKeys),
                                (JourneyLogForm.payloadX, payloadKeys)])
        let crew = fill(crewY, [(JourneyLogForm.crewX, JourneyLogForm.crewKeys)])

        func only(_ row: [String: String], _ keys: [String?]) -> [String: String] {
            var out: [String: String] = [:]
            for case let key? in keys where row[key] != nil { out[key] = row[key] }
            return out
        }

        // The heading sits above the leg table, and each field is found by the x it is
        // printed at rather than by any label of its own.
        let head = items.filter { $0.ty < legHeading.ty - 6 }
        func near(_ x: Double) -> String { head.first { abs($0.x - x) < 4 }?.text ?? "" }

        var page = JourneyLogPage()
        page.operatorName = near(53.88).trimmingCharacters(in: .whitespaces)
        page.stamp = near(156.64).trimmingCharacters(in: .whitespaces)

        let title = near(325.49)
        var number = NSRegularExpression
            .stringByReplacing(pattern: docNumberLabel, in: title, with: "")
            .trimmingCharacters(in: .whitespaces)
        if number.isEmpty { number = title.trimmingCharacters(in: .whitespaces) }
        page.docNumber = number

        if let m = captainLine.first(near(233.99)), let name = m[1] {
            page.captain = name.trimmingCharacters(in: .whitespaces)
        }

        page.legs = legs
        page.fuel = both.map { only($0, JourneyLogForm.fuelKeys) }
        page.payload = both.map { only($0, payloadKeys) }
        page.crew = crew
        return page
    }
}
