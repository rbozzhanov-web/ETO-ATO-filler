import Foundation

/// Clock arithmetic for the Journey Log, which writes its times `HH:MM` rather than the
/// flight plan's bare four figures.
public enum LogTime {

    private static let clock = Pattern("^\\s*(\\d{1,2}):?(\\d{2})\\s*$")
    private static let bareDigits = Pattern("^\\s*(\\d{3,4})\\s*$")

    public static func minutes(_ text: String) -> Int? {
        guard let m = clock.first(text), let h = m[1].flatMap({ Int($0) }),
              let mi = m[2].flatMap({ Int($0) }), h <= 23, mi <= 59 else { return nil }
        return h * 60 + mi
    }

    public static func text(_ minutes: Int) -> String {
        let n = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", n / 60, n % 60)
    }

    /// How long between two times of day, wrapping past midnight. Empty when either end is
    /// missing, so a half-filled row shows nothing rather than a wrong figure.
    public static func span(from: String, to: String) -> String {
        guard let a = minutes(from), let b = minutes(to) else { return "" }
        return text(b - a)
    }

    /// `0340` typed into a time cell becomes `03:40`. Anything else is left alone — the
    /// crew may be part-way through typing.
    public static func normalised(_ entry: String) -> String? {
        guard let m = bareDigits.first(entry), let digits = m[1] else { return nil }
        let padded = String(repeating: "0", count: max(0, 4 - digits.count)) + digits
        let value = padded.prefix(2) + ":" + padded.suffix(2)
        return minutes(String(value)) == nil ? nil : String(value)
    }
}

/// The log as it stands: what the document arrived with, and what has been typed into it.
public struct JourneyLogDocument: Codable, Equatable {

    public enum Table: String, Codable {
        case leg, fuel, payload, crew
        /// The items across the top of the sheet, which belong to the page rather than to
        /// any row. Addressed as row 0 so that every cell on the form has the same shape.
        case head
        /// The ruled lines under the crew table, addressed by their index.
        case immigration, remarks
    }

    public var pages: [JourneyLogPage] = []
    /// What the PDF held before any typing. A cell reads as print only if the document
    /// arrived with something in it.
    public var source: [JourneyLogPage] = []
    /// Cells the crew has written in themselves, which stops them being derived.
    public var manual: Set<String> = []
    public var fileName: String = ""

    public init() {}

    public init(pages: [JourneyLogPage], fileName: String) {
        self.pages = pages
        self.source = pages
        self.fileName = fileName
        refreshDerived()
    }

    public var isEmpty: Bool { pages.isEmpty }

    // MARK: - Cells

    /// A stable name for one cell, used both for the manual-entry set and by the screen to
    /// identify its fields.
    public static func path(page: Int, table: Table, row: Int, key: String) -> String {
        "pages.\(page).\(table.rawValue).\(row).\(key)"
    }

    private func rows(_ page: JourneyLogPage, _ table: Table) -> [[String: String]] {
        switch table {
        case .leg:     return page.legs
        case .fuel:    return page.fuel
        case .payload: return page.payload
        case .crew:    return page.crew
        // The heading and the ruled lines are not row tables; they are reached directly.
        case .head, .immigration, .remarks: return []
        }
    }

    private mutating func withRows(_ page: Int, _ table: Table,
                                   _ body: (inout [[String: String]]) -> Void) {
        guard pages.indices.contains(page) else { return }
        switch table {
        case .leg:     body(&pages[page].legs)
        case .fuel:    body(&pages[page].fuel)
        case .payload: body(&pages[page].payload)
        case .crew:    body(&pages[page].crew)
        case .head, .immigration, .remarks: break
        }
    }

    /// The heading items, which are the page's own rather than any row's.
    private static func head(_ page: JourneyLogPage, _ key: String) -> String {
        switch key {
        case "operator": return page.operatorName
        case "stamp":    return page.stamp
        case "docno":    return page.docNumber
        case "captain":  return page.captain
        case "cat":      return page.cat
        case "lt":       return page.lt
        default:         return ""
        }
    }

    private static func setHead(_ page: inout JourneyLogPage, _ key: String, _ text: String) {
        switch key {
        case "operator": page.operatorName = text
        case "stamp":    page.stamp = text
        case "docno":    page.docNumber = text
        case "captain":  page.captain = text
        case "cat":      page.cat = text
        case "lt":       page.lt = text
        default:         break
        }
    }

    public func value(page: Int, table: Table, row: Int, key: String) -> String {
        guard pages.indices.contains(page) else { return "" }
        switch table {
        case .head:
            return Self.head(pages[page], key)
        case .immigration:
            return pages[page].immigration.indices.contains(row) ? pages[page].immigration[row] : ""
        case .remarks:
            return pages[page].remarks.indices.contains(row) ? pages[page].remarks[row] : ""
        default:
            let table = rows(pages[page], table)
            guard table.indices.contains(row) else { return "" }
            return table[row][key] ?? ""
        }
    }

    /// What the document itself came printed with, which is shown differently from what has
    /// been typed — it is a record, not an offer.
    public func printed(page: Int, table: Table, row: Int, key: String) -> Bool {
        guard source.indices.contains(page) else { return false }
        switch table {
        case .head, .immigration, .remarks:
            // The heading is editable even where the document filled it in, and the ruled
            // lines below the crew table always arrive blank.
            return false
        default:
            let table = rows(source[page], table)
            guard table.indices.contains(row) else { return false }
            return !(table[row][key] ?? "").isEmpty
        }
    }

    public mutating func set(_ text: String, page: Int, table: Table, row: Int, key: String) {
        guard pages.indices.contains(page) else { return }
        switch table {
        case .head:
            Self.setHead(&pages[page], key, text)
        case .immigration:
            if pages[page].immigration.indices.contains(row) { pages[page].immigration[row] = text }
        case .remarks:
            if pages[page].remarks.indices.contains(row) { pages[page].remarks[row] = text }
        default:
            withRows(page, table) { rows in
                guard rows.indices.contains(row) else { return }
                rows[row][key] = text
            }
        }
        // Writing in a derived cell stops it deriving; clearing it hands it back.
        if table == .leg, key == "blk" || key == "flt" {
            let path = Self.path(page: page, table: table, row: row, key: key)
            if text.isEmpty { manual.remove(path) } else { manual.insert(path) }
        }
        refreshDerived()
    }

    // MARK: - Derived figures

    /// Blk from the block times, Flt from the wheels — until the cell is written in.
    public mutating func refreshDerived() {
        for p in pages.indices {
            for r in pages[p].legs.indices {
                for (key, from, to) in [("blk", "atd", "ata"), ("flt", "tkof", "tdwn")] {
                    let path = Self.path(page: p, table: .leg, row: r, key: key)
                    guard !manual.contains(path) else { continue }
                    let leg = pages[p].legs[r]
                    pages[p].legs[r][key] = LogTime.span(from: leg[from] ?? "", to: leg[to] ?? "")
                }
            }
        }
    }

    public func isDerived(page: Int, row: Int, key: String) -> Bool {
        (key == "blk" || key == "flt")
            && !manual.contains(Self.path(page: page, table: .leg, row: row, key: key))
    }

    // MARK: - Crew

    /// The row the captain is on, which is where the duty figures are entered before being
    /// carried down the column.
    public func captainRow(page: Int) -> Int {
        guard pages.indices.contains(page) else { return 0 }
        let found = pages[page].crew.firstIndex {
            ($0["pos"] ?? "").trimmingCharacters(in: .whitespaces).uppercased() == "CP"
        }
        return found ?? 0
    }

    /// The duty figures are the same for the whole crew far more often than not.
    public mutating func carryDown(page: Int, key: String, from row: Int) {
        guard pages.indices.contains(page), pages[page].crew.indices.contains(row) else { return }
        let value = pages[page].crew[row][key] ?? ""
        for r in pages[page].crew.indices where r != row {
            pages[page].crew[r][key] = value
        }
    }

    // MARK: - Clearing

    /// Everything the crew typed goes; everything the document arrived with stays.
    public mutating func clearEntries() {
        pages = source
        manual = []
        refreshDerived()
    }
}
