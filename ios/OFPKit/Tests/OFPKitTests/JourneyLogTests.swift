import XCTest
@testable import OFPKit

final class JourneyLogReaderTests: XCTestCase {

    private var pages: [JourneyLogPage]!

    override func setUpWithError() throws {
        let document = try PDFMiniDocument(bytes: loadFixture("synthetic-journeylog.pdf"))
        pages = try JourneyLogReader.parse(document)
    }

    func testReadsOneSheet() {
        XCTAssertEqual(pages.count, 1)
    }

    func testTablesAnnounceTheirOwnLength() {
        let page = pages[0]
        XCTAssertEqual(page.legs.count, 3, "two flown and one blank, all numbered")
        XCTAssertEqual(page.fuel.count, 2)
        XCTAssertEqual(page.payload.count, 2)
        XCTAssertEqual(page.crew.count, 3)
    }

    func testReadsTheHeading() {
        let page = pages[0]
        XCTAssertEqual(page.operatorName, "Air Astana JSC")
        XCTAssertEqual(page.stamp, "13/08/2026")
        XCTAssertEqual(page.docNumber, "KC-2026-004417", "the label is stripped off")
        XCTAssertEqual(page.captain, "BOZZHANOV R.")
    }

    func testDecodesTextThroughTheFontsToUnicodeMap() {
        // Drawn as two-byte glyph codes; without the CMap this would be mojibake.
        XCTAssertEqual(pages[0].legs[0]["flight"], "KC937")
        XCTAssertEqual(pages[0].crew[0]["name"], "BOZZHANOV R.")
    }

    func testReadsTheCellsTheDocumentArrivesWith() {
        let leg = pages[0].legs[0]
        XCTAssertEqual(leg["date"], "13AUG")
        XCTAssertEqual(leg["acreg"], "P4-KDC")
        XCTAssertEqual(leg["dep"], "UAAA")
        XCTAssertEqual(leg["arr"], "RKSI")
        XCTAssertEqual(leg["std"], "01:45")
        XCTAssertEqual(leg["sta"], "09:05")
        XCTAssertNil(leg["atd"], "the actuals are for the crew to write")
    }

    func testABlankRowIsStillARow() {
        let blank = pages[0].legs[2]
        XCTAssertNil(blank["flight"])
        XCTAssertNil(blank["date"])
    }

    func testFuelAndPayloadShareTheirBandButNotTheirColumns() {
        XCTAssertEqual(pages[0].fuel[0]["init"], "1200")
        XCTAssertEqual(pages[0].fuel[0]["calcramp"], "29647")
        XCTAssertNil(pages[0].fuel[0]["adl"], "a payload column never lands in the fuel row")

        XCTAssertEqual(pages[0].payload[0]["adl"], "148")
        XCTAssertEqual(pages[0].payload[0]["zfw"], "116632")
        XCTAssertNil(pages[0].payload[0]["init"])
    }

    func testCrew() {
        XCTAssertEqual(pages[0].crew.map { $0["pos"] }, ["CP", "FO", "CC"])
        XCTAssertEqual(pages[0].crew[1]["staff"], "10388")
    }

    func testRejectsSomethingThatIsNotAJourneyLog() throws {
        let other = try PDFMiniDocument(bytes: loadFixture("synthetic-ofp.pdf"))
        XCTAssertThrowsError(try JourneyLogReader.parse(other)) { error in
            XCTAssertEqual("\(error)", JourneyLogError.notAJourneyLog.description)
        }
    }
}

final class LogTimeTests: XCTestCase {

    func testReadsBothSpellings() {
        XCTAssertEqual(LogTime.minutes("03:40"), 220)
        XCTAssertEqual(LogTime.minutes("0340"), 220)
        XCTAssertEqual(LogTime.minutes(" 3:40 "), 220)
        XCTAssertNil(LogTime.minutes("24:00"))
        XCTAssertNil(LogTime.minutes("03:60"))
        XCTAssertNil(LogTime.minutes(""))
    }

    func testSpansWrapPastMidnight() {
        XCTAssertEqual(LogTime.span(from: "01:45", to: "09:05"), "07:20")
        XCTAssertEqual(LogTime.span(from: "23:30", to: "01:10"), "01:40")
        XCTAssertEqual(LogTime.span(from: "01:45", to: ""), "", "a half-filled row shows nothing")
    }

    func testFourDigitsBecomeAClock() {
        XCTAssertEqual(LogTime.normalised("0340"), "03:40")
        XCTAssertEqual(LogTime.normalised("340"), "03:40")
        XCTAssertNil(LogTime.normalised("03:40"), "already a clock; left alone")
        XCTAssertNil(LogTime.normalised("2500"), "not a time")
        XCTAssertNil(LogTime.normalised("34"), "still being typed")
    }
}

final class JourneyLogDocumentTests: XCTestCase {

    private func document() throws -> JourneyLogDocument {
        let pdf = try PDFMiniDocument(bytes: loadFixture("synthetic-journeylog.pdf"))
        return JourneyLogDocument(pages: try JourneyLogReader.parse(pdf), fileName: "log.pdf")
    }

    func testBlockTimeIsWorkedOutFromTheBlocks() throws {
        var doc = try document()
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "blk"), "")

        doc.set("01:52", page: 0, table: .leg, row: 0, key: "atd")
        doc.set("09:12", page: 0, table: .leg, row: 0, key: "ata")
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "blk"), "07:20")
        XCTAssertTrue(doc.isDerived(page: 0, row: 0, key: "blk"))
    }

    func testFlightTimeComesFromTheWheels() throws {
        var doc = try document()
        doc.set("02:05", page: 0, table: .leg, row: 0, key: "tkof")
        doc.set("08:55", page: 0, table: .leg, row: 0, key: "tdwn")
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "flt"), "06:50")
    }

    func testWritingInADerivedCellStopsItDeriving() throws {
        var doc = try document()
        doc.set("01:52", page: 0, table: .leg, row: 0, key: "atd")
        doc.set("09:12", page: 0, table: .leg, row: 0, key: "ata")
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "blk"), "07:20")

        doc.set("07:30", page: 0, table: .leg, row: 0, key: "blk")
        XCTAssertFalse(doc.isDerived(page: 0, row: 0, key: "blk"))
        doc.set("09:20", page: 0, table: .leg, row: 0, key: "ata")
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "blk"), "07:30",
                       "what was written by hand stands")

        // Clearing it hands the cell back to the arithmetic.
        doc.set("", page: 0, table: .leg, row: 0, key: "blk")
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "blk"), "07:28")
    }

    func testWhatTheDocumentCamePrintedWith() throws {
        let doc = try document()
        XCTAssertTrue(doc.printed(page: 0, table: .leg, row: 0, key: "flight"))
        XCTAssertFalse(doc.printed(page: 0, table: .leg, row: 0, key: "atd"),
                       "an actual is never printed; it is for the crew")
        XCTAssertTrue(doc.printed(page: 0, table: .crew, row: 0, key: "name"))
    }

    func testCaptainsRowCarriesTheDutyFigureDown() throws {
        var doc = try document()
        XCTAssertEqual(doc.captainRow(page: 0), 0, "the CP row")

        doc.set("12:40", page: 0, table: .crew, row: 0, key: "dutytime")
        doc.carryDown(page: 0, key: "dutytime", from: 0)
        for r in 0..<3 {
            XCTAssertEqual(doc.value(page: 0, table: .crew, row: r, key: "dutytime"), "12:40")
        }
    }

    func testClearingKeepsWhatTheDocumentArrivedWith() throws {
        var doc = try document()
        doc.set("01:52", page: 0, table: .leg, row: 0, key: "atd")
        doc.set("07:30", page: 0, table: .leg, row: 0, key: "blk")

        doc.clearEntries()
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "atd"), "")
        XCTAssertEqual(doc.value(page: 0, table: .leg, row: 0, key: "flight"), "KC937",
                       "the document's own print stays")
        XCTAssertTrue(doc.manual.isEmpty)
    }

    func testSurvivesARoundTripThroughJSON() throws {
        var doc = try document()
        doc.set("01:52", page: 0, table: .leg, row: 0, key: "atd")
        doc.set("PAX 148", page: 0, table: .crew, row: 0, key: "remarks")
        doc.pages[0].remarks[0] = "NIL"

        let data = try JSONEncoder().encode(doc)
        XCTAssertEqual(try JSONDecoder().decode(JourneyLogDocument.self, from: data), doc)
    }
}

final class JourneyLogLayoutTests: XCTestCase {

    private func layout() throws -> (JourneyLogDocument, JourneyLogLayout) {
        let pdf = try PDFMiniDocument(bytes: loadFixture("synthetic-journeylog.pdf"))
        let doc = JourneyLogDocument(pages: try JourneyLogReader.parse(pdf), fileName: "log.pdf")
        return (doc, JourneyLogLayout.build(document: doc, page: 0))
    }

    func testEveryCellOfEveryTableGetsAField() throws {
        let (doc, sheet) = try layout()
        let page = doc.pages[0]

        func count(_ table: JourneyLogDocument.Table) -> Int {
            sheet.fields.filter { $0.table == table }.count
        }
        let legKeys = JourneyLogForm.legKeys.compactMap { $0 }.count
        XCTAssertEqual(count(.leg), legKeys * page.legs.count)
        XCTAssertEqual(count(.fuel), JourneyLogForm.fuelKeys.compactMap { $0 }.count * page.fuel.count)
        XCTAssertEqual(count(.payload), JourneyLogForm.payloadKeys.count * page.payload.count)
        XCTAssertEqual(count(.crew), JourneyLogForm.crewKeys.compactMap { $0 }.count * page.crew.count)
        XCTAssertEqual(count(.immigration), 3)
        XCTAssertEqual(count(.remarks), 3)
    }

    func testPrintedCellsAreMarkedAsSuch() throws {
        let (_, sheet) = try layout()
        let flight = sheet.fields.first { $0.table == .leg && $0.row == 0 && $0.key == "flight" }
        XCTAssertEqual(flight?.printed, true, "the document arrived with it")

        let atd = sheet.fields.first { $0.table == .leg && $0.row == 0 && $0.key == "atd" }
        XCTAssertEqual(atd?.printed, false, "an actual is for the crew")
        XCTAssertEqual(atd?.time, true)

        // The third leg arrived blank, so even its date is a box to be written in.
        let blankDate = sheet.fields.first { $0.table == .leg && $0.row == 2 && $0.key == "date" }
        XCTAssertEqual(blankDate?.printed, false)
    }

    func testCellsSitInsideTheirColumn() throws {
        let (_, sheet) = try layout()
        let lw = JourneyLogForm.ruleWidth
        for field in sheet.fields where field.table == .leg {
            guard let c = JourneyLogForm.legKeys.firstIndex(of: field.key) else { continue }
            XCTAssertEqual(field.x, JourneyLogForm.legX[c] + lw, accuracy: 0.001)
            XCTAssertEqual(field.width, JourneyLogForm.legX[c + 1] - JourneyLogForm.legX[c] - lw * 2,
                           accuracy: 0.001)
        }
    }

    func testTheSheetGrowsWithTheDocument() throws {
        let (doc, small) = try layout()

        var bigger = doc
        bigger.pages[0].legs.append([:])
        bigger.pages[0].crew.append([:])
        let large = JourneyLogLayout.build(document: bigger, page: 0)

        XCTAssertGreaterThan(large.contentHeight, small.contentHeight,
                             "an extra leg and an extra crew member push the sheet down")
        XCTAssertEqual(large.contentHeight - small.contentHeight,
                       JourneyLogForm.rowHeight * 2, accuracy: 0.001)
    }

    func testEverythingFitsOnTheSheet() throws {
        let (_, sheet) = try layout()
        for field in sheet.fields {
            XCTAssertGreaterThanOrEqual(field.x, 0)
            XCTAssertLessThanOrEqual(field.x + field.width, JourneyLogForm.pageWidth)
        }
        XCTAssertLessThanOrEqual(sheet.contentHeight, JourneyLogForm.pageHeight)
    }

    func testTheCaptainsRowCarriesTheDuplicators() throws {
        let (_, sheet) = try layout()
        XCTAssertEqual(sheet.duplicators.count, JourneyLogForm.crewDuplicable.count)
        XCTAssertTrue(sheet.duplicators.allSatisfy { $0.from == 0 }, "the CP row")
    }

    func testNoFieldOverlapsAnother() throws {
        let (_, sheet) = try layout()
        let boxes = sheet.fields.map { ($0.x, $0.y, $0.x + $0.width, $0.y + $0.height) }
        for i in 0..<boxes.count {
            for j in (i + 1)..<boxes.count {
                let a = boxes[i], b = boxes[j]
                let overlaps = a.0 < b.2 - 0.01 && b.0 < a.2 - 0.01
                    && a.1 < b.3 - 0.01 && b.1 < a.3 - 0.01
                XCTAssertFalse(overlaps, "two cells share the same paper: \(a) and \(b)")
            }
        }
    }
}
