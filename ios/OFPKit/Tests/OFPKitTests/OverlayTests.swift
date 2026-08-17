import XCTest
@testable import OFPKit

/// The whole path a real save takes: read a plan, fill it in, write the overlay, then open
/// the result and read back what was written.
final class OverlayTests: XCTestCase {

    private var document: PDFMiniDocument!
    private var plan: ParsedPlan!
    private var computer: FlightComputer!

    override func setUpWithError() throws {
        document = try PDFMiniDocument(bytes: loadFixture("synthetic-ofp.pdf"))
        plan = try OFPParser.parse(document)
        let rows = FlightComputer.rows(from: plan.waypoints, takeoff: 130, includeAlternate: false)
        computer = FlightComputer(rows: rows, takeoff: 130)
    }

    private func build(actuals: [Int: Actual] = [:],
                       fields: [Int: String] = [:],
                       readings: [Int: AltimeterReading] = [:]) throws -> PDFMiniDocument {
        computer.actuals = actuals
        let input = OverlayBuilder.Input(
            plan: plan, rows: computer.rows, actuals: actuals, fieldText: fields,
            altimeterChecks: computer.altimeterChecks(), readings: readings)
        return try PDFMiniDocument(bytes: try OverlayBuilder.build(input, document: document))
    }

    private func text(_ doc: PDFMiniDocument, page: Int) throws -> [String] {
        PDFText.items(in: try doc.content(of: doc.pages()[page])).map(\.text)
    }

    func testWritesEveryEtoOntoTheForm() throws {
        let out = try build()
        // Takeoff 0210; ALMATY is at +0 and TOKPA at +12.
        let page = try text(out, page: 1)
        XCTAssertTrue(page.contains("0210"), "ALMATY")
        XCTAssertTrue(page.contains("0222"), "TOKPA")
        XCTAssertTrue(page.contains("0231"), "USOLA")
    }

    func testWritesTheActualsEntered() throws {
        let out = try build(actuals: [1: Actual(ato: "0224", fuel: "28400")])
        let page = try text(out, page: 1)
        XCTAssertTrue(page.contains("0224"), "the ATO as entered")
        XCTAssertTrue(page.contains("28400"), "and the fuel beside it")
    }

    func testFuelDifferenceIsSignedAgainstThePlan() throws {
        // TOKPA is planned at 29647 - 12*95 = 28507.
        let above = try build(actuals: [1: Actual(fuel: "28600")])
        XCTAssertTrue(try text(above, page: 1).contains("+93"))

        let below = try build(actuals: [1: Actual(fuel: "28400")])
        XCTAssertTrue(try text(below, page: 1).contains("-107"))

        let exact = try build(actuals: [1: Actual(fuel: "28507")])
        XCTAssertTrue(try text(exact, page: 1).contains("0"))
    }

    func testFuelColumnHeadingOnlyWhereThereIsAFigure() throws {
        let none = try build()
        XCTAssertFalse(try text(none, page: 1).contains("FUEL"),
                       "no heading over an empty column")

        let some = try build(actuals: [1: Actual(fuel: "28400")])
        let page = try text(some, page: 1)
        XCTAssertTrue(page.contains("FUEL"))
        XCTAssertTrue(page.contains("DIFF"))

        XCTAssertFalse(try text(some, page: 2).contains("FUEL"),
                       "and none on a page that carries no figure")
    }

    func testIncompleteAtoIsNotWritten() throws {
        let out = try build(actuals: [1: Actual(ato: "02")])
        XCTAssertFalse(try text(out, page: 1).contains("02"),
                       "a half-typed time never reaches the document")
    }

    func testDocumentFieldsAreWrittenAndWrapped() throws {
        let clearance = try XCTUnwrap(plan.fields.first { $0.label == "ATC CLRNC" })
        let long = "CLEARED TO RKSI VIA TOKPA UL551 USOLA FL340 SQUAWK 2456 DEPARTURE RWY 05L"
        let out = try build(fields: [clearance.index: long])
        let page = try text(out, page: 0)

        // It runs onto a second line, so the words are split between two runs but nothing
        // is lost and no word is broken in the middle.
        let written = page.filter { long.contains($0) && $0.count > 3 }
        XCTAssertGreaterThanOrEqual(written.count, 2, "it wrapped onto the spare line")
        let rejoined = written.joined(separator: " ")
        XCTAssertTrue(rejoined.contains("CLEARED TO RKSI"))
        XCTAssertTrue(rejoined.contains("SQUAWK 2456"))
    }

    func testFieldTextIsClippedToTheRoomAvailable() throws {
        let altimeter = try XCTUnwrap(plan.fields.first { $0.label == "ALTM1" })
        XCTAssertEqual(altimeter.capacity, 5)
        let parts = FormGeometry.layout("1013", over: altimeter.segments)
        XCTAssertEqual(parts, ["1013"])
    }

    func testAltimeterCrossCheckLine() throws {
        let checks = computer.altimeterChecks()
        let first = try XCTUnwrap(checks.first)
        let out = try build(readings: [
            first.mark: AltimeterReading(altimeter1: "1013", standby: "1012", altimeter2: "1013")
        ])
        let page = try text(out, page: first.row.waypoint.page)
        let line = try XCTUnwrap(page.first { $0.hasPrefix("ALTM CHK") })
        XCTAssertTrue(line.contains("ALTM1 1013"))
        XCTAssertTrue(line.contains("STBY 1012"))
        XCTAssertTrue(line.contains("ALTM2 1013"))
    }

    func testPartialCrossCheckShowsDotsForWhatIsMissing() throws {
        let first = try XCTUnwrap(computer.altimeterChecks().first)
        let out = try build(readings: [first.mark: AltimeterReading(altimeter1: "1013")])
        let page = try text(out, page: first.row.waypoint.page)
        let line = try XCTUnwrap(page.first { $0.hasPrefix("ALTM CHK") })
        XCTAssertTrue(line.contains("STBY ...."), "an unfilled box stays a blank")
    }

    func testEmptyCrossCheckWritesNothing() throws {
        let first = try XCTUnwrap(computer.altimeterChecks().first)
        let out = try build(readings: [first.mark: AltimeterReading()])
        let page = try text(out, page: first.row.waypoint.page)
        XCTAssertFalse(page.contains { $0.hasPrefix("ALTM CHK") })
    }

    func testTheOriginalIsNeverRewritten() throws {
        let out = try OverlayBuilder.build(
            OverlayBuilder.Input(plan: plan, rows: computer.rows,
                                 actuals: [1: Actual(ato: "0224", fuel: "28400")],
                                 fieldText: [:], altimeterChecks: [], readings: [:]),
            document: document)
        XCTAssertEqual(Array(out.prefix(document.bytes.count)), document.bytes)
    }

    func testOutputIsByteIdenticalForTheSameInput() throws {
        // Two saves of the same state must produce the same file — no dictionary ordering
        // leaking into the bytes.
        let input = OverlayBuilder.Input(
            plan: plan, rows: computer.rows,
            actuals: [1: Actual(ato: "0224", fuel: "28400"), 5: Actual(ato: "0320")],
            fieldText: [0: "ABC"], altimeterChecks: computer.altimeterChecks(),
            readings: [60: AltimeterReading(altimeter1: "1013")])
        let a = try OverlayBuilder.build(input, document: document)
        let b = try OverlayBuilder.build(input, document: document)
        XCTAssertEqual(a, b)
    }
}

final class SessionStoreTests: XCTestCase {

    private func store() -> SessionStore {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ofpkit-tests-\(UUID().uuidString)")
        return SessionStore(directory: dir)
    }

    func testStateSurvivesARoundTrip() throws {
        let s = store()
        let key = DocumentKey(name: "ALAICN01 (1).pdf", size: 4_312_770)

        var state = SessionState()
        state.takeoffTime = "0210"
        state.includeAlternate = true
        state.actuals = [3: Actual(ato: "0224", fuel: "28400")]
        state.fieldText = [0: "ATIS BRAVO"]
        state.readings = [60: AltimeterReading(altimeter1: "1013", standby: "1012")]
        state.alerted = [60]
        state.alarmEnabled = false
        state.directs = [DirectMark(to: 9, skipped: [6, 7, 8])]

        s.save(state, for: key)
        XCTAssertEqual(s.loadState(for: key), state)

        s.clearState(for: key)
        XCTAssertNil(s.loadState(for: key))
    }

    func testDocumentResume() throws {
        let s = store()
        let bytes = try loadFixture("synthetic-ofp.pdf")
        let key = DocumentKey(name: "plan.pdf", size: bytes.count)

        XCTAssertNil(s.resumeDocument())
        s.keepDocument(bytes, key: key)

        let resumed = try XCTUnwrap(s.resumeDocument())
        XCTAssertEqual(resumed.bytes, bytes)
        XCTAssertEqual(resumed.key, key)

        s.dropDocument()
        XCTAssertNil(s.resumeDocument())
    }

    func testAwkwardDocumentNamesStillGetAFile() {
        let s = store()
        let key = DocumentKey(name: "../../etc/passwd — plan/2026.pdf", size: 10)
        var state = SessionState()
        state.takeoffTime = "0330"
        s.save(state, for: key)
        XCTAssertEqual(s.loadState(for: key)?.takeoffTime, "0330")
    }
}
