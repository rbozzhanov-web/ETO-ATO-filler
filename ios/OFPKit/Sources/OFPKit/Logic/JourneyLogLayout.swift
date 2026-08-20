import Foundation

/// The sheet, described once in points.
///
/// The screen draws it and the printer draws it, and they must agree to the point or what
/// the crew typed sits somewhere else on the paper. So neither owns the geometry: both read
/// this, and it can be checked without either.
public struct JourneyLogLayout: Equatable {

    public enum Align: Equatable { case leading, centre }

    /// A hairline of the form's own ruling.
    public struct Rule: Equatable {
        public let x, y, width, height: Double
    }

    /// A shaded heading band behind a row of titles.
    public struct Band: Equatable {
        public let x, y, width, height: Double
        /// The sub-heading band is lighter than the title band above it.
        public let light: Bool
    }

    /// Type the form itself carries — column titles, the footnote, the captions.
    public struct Caption: Equatable {
        public let x, y, width, height: Double
        public let text: String
        public let bold: Bool
        public let align: Align
        /// Free-standing captions size themselves to their text rather than to a column.
        public let sizesToText: Bool
    }

    /// A cell that can be typed into.
    public struct Field: Equatable {
        public let x, y, width, height: Double
        public let table: JourneyLogDocument.Table
        public let row: Int
        public let key: String
        /// The document arrived with this filled in, so it is shown as a record and locked.
        public let printed: Bool
        public let time: Bool
        public let numeric: Bool
        public let align: Align

        public func path(page: Int) -> String {
            JourneyLogDocument.path(page: page, table: table, row: row, key: key)
        }
    }

    /// The button on the captain's row that puts his figure on every other.
    public struct Duplicator: Equatable {
        public let x, y: Double
        public let key: String
        public let from: Int
    }

    public var rules: [Rule] = []
    public var bands: [Band] = []
    public var captions: [Caption] = []
    public var fields: [Field] = []
    public var duplicators: [Duplicator] = []
    /// How far down the sheet the drawn content reaches.
    public var contentHeight: Double = 0

    // MARK: - Building

    private static let form = JourneyLogForm.self

    /// The form's rules, drawn the way the document draws them: hairlines at every column
    /// edge, and a doubled weight where two rows meet.
    private mutating func grid(_ xs: [Double], top: Double, rows: Int, rowHeight: Double) {
        let lw = JourneyLogForm.ruleWidth
        guard let x0 = xs.first, let x1 = xs.last else { return }
        let height = Double(rows) * rowHeight
        for (i, x) in xs.enumerated() {
            rules.append(Rule(x: i == 0 ? x : x - lw, y: top, width: lw, height: height))
        }
        for i in 0...rows {
            let y = top + Double(i) * rowHeight
            if i == 0 {
                rules.append(Rule(x: x0, y: y, width: x1 - x0, height: lw))
            } else if i == rows {
                rules.append(Rule(x: x0, y: y - lw, width: x1 - x0, height: lw))
            } else {
                rules.append(Rule(x: x0, y: y - lw, width: x1 - x0, height: lw * 2))
            }
        }
    }

    private mutating func caption(_ x: Double, _ y: Double, _ w: Double, _ h: Double,
                                  _ text: String, bold: Bool = false,
                                  align: Align = .centre, sizesToText: Bool = false) {
        captions.append(Caption(x: x, y: y, width: w, height: h, text: text,
                                bold: bold, align: align, sizesToText: sizesToText))
    }

    private mutating func field(_ x0: Double, _ x1: Double, _ y: Double, _ h: Double,
                                table: JourneyLogDocument.Table, row: Int, key: String,
                                printed: Bool, time: Bool, numeric: Bool,
                                align: Align = .centre) {
        let lw = JourneyLogForm.ruleWidth
        fields.append(Field(x: x0 + lw, y: y + lw,
                            width: x1 - x0 - lw * 2, height: h - lw * 2,
                            table: table, row: row, key: key,
                            printed: printed, time: time, numeric: numeric, align: align))
    }

    /// One numbered table: a heading band, its column titles, and a row per entry.
    private mutating func table(xs: [Double], keys: [String?], headers: [String],
                                top: Double, count: Int,
                                table kind: JourneyLogDocument.Table,
                                printedKeys: Set<String>, timeKeys: Set<String>,
                                document: JourneyLogDocument, page: Int,
                                leftAligned: Set<String> = []) {
        let row = JourneyLogForm.rowHeight
        guard let x0 = xs.first, let x1 = xs.last else { return }
        bands.append(Band(x: x0, y: top, width: x1 - x0, height: row, light: false))
        grid(xs, top: top, rows: 1 + count, rowHeight: row)

        for (c, title) in headers.enumerated() where !title.isEmpty && c + 1 < xs.count {
            caption(xs[c], top, xs[c + 1] - xs[c], row, title, bold: true)
        }

        for r in 0..<count {
            let y = top + row * Double(1 + r)
            caption(xs[0], y, xs[1] - xs[0], row, String(r + 1))
            for (c, key) in keys.enumerated() {
                guard let key, c + 1 < xs.count else { continue }
                field(xs[c], xs[c + 1], y, row,
                      table: kind, row: r, key: key,
                      printed: printedKeys.contains(key)
                        && document.printed(page: page, table: kind, row: r, key: key),
                      time: timeKeys.contains(key),
                      numeric: timeKeys.contains(key),
                      align: leftAligned.contains(key) ? .leading : .centre)
            }
        }
    }

    public static func build(document: JourneyLogDocument, page index: Int) -> JourneyLogLayout {
        var out = JourneyLogLayout()
        guard document.pages.indices.contains(index) else { return out }
        let page = document.pages[index]
        let row = JourneyLogForm.rowHeight

        // ---- heading ----
        let headHeight = 9.75
        out.caption(53.88, 18.74, 240, headHeight, "", align: .leading)
        out.fields.append(Field(x: 53.88, y: 18.74, width: 100, height: headHeight,
                                table: .head, row: 0, key: "operator",
                                printed: false, time: false, numeric: false, align: .leading))
        out.rules.append(Rule(x: 53.88, y: 27.36, width: 49.78, height: 0.7))

        out.fields.append(Field(x: 156.64, y: 18.74, width: 100, height: headHeight,
                                table: .head, row: 0, key: "stamp",
                                printed: false, time: false, numeric: false, align: .leading))
        out.rules.append(Rule(x: 156.64, y: 27.36, width: 79.73, height: 0.7))

        out.caption(325.49, 18.74, 150, headHeight,
                    "Journey Log No./Задание на полет", align: .leading, sizesToText: true)
        out.fields.append(Field(x: 478, y: 18.74, width: 130, height: headHeight,
                                table: .head, row: 0, key: "docno",
                                printed: false, time: false, numeric: false, align: .leading))
        out.rules.append(Rule(x: 325.49, y: 27.36, width: 211.62, height: 0.7))

        out.caption(233.99, 32.14, 60, headHeight, "Captain/KBC:", align: .leading, sizesToText: true)
        out.fields.append(Field(x: 296, y: 32.14, width: 130, height: headHeight,
                                table: .head, row: 0, key: "captain",
                                printed: false, time: false, numeric: false, align: .leading))
        out.caption(430, 32.14, 190, headHeight,
                    "//FD Crew Minima/Минимум экипажа: CAT", align: .leading, sizesToText: true)
        out.fields.append(Field(x: 624, y: 32.14, width: 26, height: headHeight,
                                table: .head, row: 0, key: "cat",
                                printed: false, time: false, numeric: false, align: .leading))
        out.caption(654, 32.14, 22, headHeight, "L/T", align: .leading, sizesToText: true)
        out.fields.append(Field(x: 678, y: 32.14, width: 26, height: headHeight,
                                table: .head, row: 0, key: "lt",
                                printed: false, time: false, numeric: false, align: .leading))

        // ---- legs ----
        out.table(xs: JourneyLogForm.legX, keys: JourneyLogForm.legKeys,
                  headers: JourneyLogForm.legHeaders,
                  top: JourneyLogForm.legTop, count: page.legs.count, table: .leg,
                  printedKeys: JourneyLogForm.legPrinted, timeKeys: JourneyLogForm.legTimes,
                  document: document, page: index)

        // ---- fuel and payload, which share a band ----
        let legBottom = JourneyLogForm.legTop + row * Double(1 + page.legs.count)
        let fuelTitle = legBottom + JourneyLogForm.gapToFuel
        let right = JourneyLogForm.payloadX.last ?? 748.52
        let split = JourneyLogForm.payloadX.first ?? 470.76

        out.bands.append(Band(x: 17.28, y: fuelTitle, width: right - 17.28, height: row, light: false))
        out.grid([17.28, split, right], top: fuelTitle, rows: 1, rowHeight: row)
        out.caption(17.28, fuelTitle, split - 17.28, row, "Fuel/Информация о топливе", bold: true)
        out.caption(split, fuelTitle, right - split, row,
                    "PayLoad / Данные о коммерческой загрузке", bold: true)

        let fuelHead = fuelTitle + row
        out.bands.append(Band(x: 17.28, y: fuelHead, width: right - 17.28, height: row, light: true))
        out.grid(JourneyLogForm.fuelX + JourneyLogForm.payloadX.dropFirst(),
                 top: fuelHead, rows: 1 + page.fuel.count, rowHeight: row)

        for (c, title) in JourneyLogForm.fuelHeaders.enumerated()
        where !title.isEmpty && c + 1 < JourneyLogForm.fuelX.count {
            out.caption(JourneyLogForm.fuelX[c], fuelHead,
                        JourneyLogForm.fuelX[c + 1] - JourneyLogForm.fuelX[c], row, title)
        }
        for (c, title) in JourneyLogForm.payloadHeaders.enumerated()
        where c + 1 < JourneyLogForm.payloadX.count {
            out.caption(JourneyLogForm.payloadX[c], fuelHead,
                        JourneyLogForm.payloadX[c + 1] - JourneyLogForm.payloadX[c], row, title)
        }
        for r in 0..<page.fuel.count {
            let y = fuelHead + row * Double(1 + r)
            out.caption(17.28, y, 28.61 - 17.28, row, String(r + 1))
            for (c, key) in JourneyLogForm.fuelKeys.enumerated() {
                guard let key, c + 1 < JourneyLogForm.fuelX.count else { continue }
                out.field(JourneyLogForm.fuelX[c], JourneyLogForm.fuelX[c + 1], y, row,
                          table: .fuel, row: r, key: key,
                          printed: false, time: false, numeric: true)
            }
            for (c, key) in JourneyLogForm.payloadKeys.enumerated()
            where c + 1 < JourneyLogForm.payloadX.count {
                out.field(JourneyLogForm.payloadX[c], JourneyLogForm.payloadX[c + 1], y, row,
                          table: .payload, row: r, key: key,
                          printed: false, time: false, numeric: true)
            }
        }

        // ---- crew ----
        let fuelBottom = fuelTitle + row * Double(2 + page.fuel.count)
        let crewTop = fuelBottom + JourneyLogForm.gapToCrew
        out.table(xs: JourneyLogForm.crewX, keys: JourneyLogForm.crewKeys,
                  headers: JourneyLogForm.crewHeaders,
                  top: crewTop, count: page.crew.count, table: .crew,
                  printedKeys: JourneyLogForm.crewPrinted, timeKeys: JourneyLogForm.crewTimes,
                  document: document, page: index, leftAligned: ["remarks"])

        let crewBottom = crewTop + row * Double(1 + page.crew.count)

        // The duty figures are the same for the whole crew far more often than not.
        if page.crew.count > 1 {
            let captain = document.captainRow(page: index)
            for key in JourneyLogForm.crewDuplicable {
                guard let c = JourneyLogForm.crewKeys.firstIndex(of: key),
                      c + 1 < JourneyLogForm.crewX.count else { continue }
                out.duplicators.append(Duplicator(
                    x: JourneyLogForm.crewX[c + 1] - 10.5,
                    y: crewTop + row * Double(1 + captain) + (row - 9) / 2,
                    key: key, from: captain))
            }
        }

        // ---- footnote, immigration, remarks ----
        out.caption(18.78, crewBottom + 2.56, 400, 7.5,
                    "x : Operating Leg    * : Deadheading Leg    - : PAX Leg    "
                    + ". : Crew member not on board A/C", align: .leading, sizesToText: true)
        out.caption(18.78, crewBottom + 13.81, 220, 7.5,
                    "IMMIGRATION CONTROL/Отметки пограничной службы",
                    bold: true, align: .leading, sizesToText: true)

        for (i, dy) in JourneyLogForm.immigrationRules.enumerated() {
            let y = crewBottom + dy
            out.rules.append(Rule(x: 17.28, y: y, width: 392.23 - 17.28, height: 0.72))
            let x0 = i == 0 ? 200.5 : 18.28
            out.fields.append(Field(x: x0, y: y - 10, width: 391.5 - x0, height: 10,
                                    table: .immigration, row: i, key: "line",
                                    printed: false, time: false, numeric: false, align: .leading))
        }

        let boxTop = crewBottom + JourneyLogForm.remarksBox.top
        let boxBottom = crewBottom + JourneyLogForm.remarksBox.bottom
        let bx0 = JourneyLogForm.remarksBox.x0, bx1 = JourneyLogForm.remarksBox.x1
        let lw = JourneyLogForm.ruleWidth
        out.rules.append(Rule(x: bx0, y: boxTop, width: bx1 - bx0, height: lw))
        out.rules.append(Rule(x: bx0, y: boxBottom - lw, width: bx1 - bx0, height: lw))
        out.rules.append(Rule(x: bx0, y: boxTop, width: lw, height: boxBottom - boxTop))
        out.rules.append(Rule(x: bx1 - lw, y: boxTop, width: lw, height: boxBottom - boxTop))
        out.caption(493.83, crewBottom + 14.26, 90, 7.5, "Remarks/Ремарки",
                    bold: true, align: .leading, sizesToText: true)

        for (i, dy) in JourneyLogForm.immigrationRules.enumerated() {
            let y = crewBottom + dy
            out.rules.append(Rule(x: 492.33, y: y, width: 816.67 - 492.33, height: 0.72))
            let x0 = i == 0 ? 556.0 : 493.5
            out.fields.append(Field(x: x0, y: y - 10, width: 816 - x0, height: 10,
                                    table: .remarks, row: i, key: "line",
                                    printed: false, time: false, numeric: false, align: .leading))
        }

        // The signature is put on the paper by hand, so there is nothing to type here.
        out.caption(493.83, crewBottom + 59.63, 120, 7.5, "Captain's Signature",
                    bold: true, align: .leading, sizesToText: true)
        out.caption(493.83, crewBottom + 68.78, 120, 7.5, "Подпись KBC:",
                    bold: true, align: .leading, sizesToText: true)

        out.contentHeight = crewBottom + JourneyLogForm.remarksBox.bottom
        return out
    }
}
