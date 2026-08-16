import XCTest
@testable import OFPKit

final class ParserTests: XCTestCase {

    private var plan: ParsedPlan!
    private var document: PDFMiniDocument!

    override func setUpWithError() throws {
        document = try PDFMiniDocument(bytes: loadFixture("synthetic-ofp.pdf"))
        plan = try OFPParser.parse(document)
    }

    // MARK: - Waypoints

    func testReadsEveryWaypoint() {
        XCTAssertEqual(plan.waypoints.count, 18, "fifteen on the main route, three on the alternate")
        XCTAssertEqual(plan.waypoints.first?.name, "ALMATY")
        XCTAssertEqual(plan.waypoints.map(\.name).prefix(4), ["ALMATY", "TOKPA", "USOLA", "BALKH"])
    }

    func testLegAndCumulativeTimes() {
        let main = plan.waypoints.filter { $0.section == 1 }
        XCTAssertEqual(main.count, 15)
        XCTAssertEqual(main.map(\.et).prefix(5), [0, 12, 9, 14, 11])
        XCTAssertEqual(main.map(\.cum).prefix(5), [0, 12, 21, 35, 46])
        XCTAssertEqual(main.last?.cum, 201, "the whole trip in minutes")
    }

    func testSplitsTheAlternateIntoItsOwnSection() {
        let alternate = plan.waypoints.filter { $0.section == 2 }
        XCTAssertEqual(alternate.map(\.name), ["RKSICF", "GIMPO", "RKSS"])
        // The alternate restarts its own running total from zero.
        XCTAssertEqual(alternate.map(\.cum), [0, 11, 19])
    }

    func testNoDriftOnAConsistentPlan() {
        XCTAssertTrue(plan.waypoints.allSatisfy { !$0.drift },
                      "the leg times add up to the printed totals, so nothing is flagged")
    }

    func testPlannedFuelRemaining() {
        XCTAssertEqual(plan.waypoints.first?.remaining, 29647)
        XCTAssertEqual(plan.waypoints.first(where: { $0.name == "TOKPA" })?.remaining,
                       29647 - 12 * 95)
    }

    func testBothColumnsAreLocated() {
        for waypoint in plan.waypoints {
            XCTAssertEqual(waypoint.etoX, 470, accuracy: 0.01)
            XCTAssertEqual(waypoint.atoX, 470, accuracy: 0.01)
            XCTAssertEqual(waypoint.etoY - waypoint.atoY, 12.05, accuracy: 0.01)
            XCTAssertNotNil(waypoint.font, "the overlay needs the page's Courier resource")
        }
        XCTAssertEqual(plan.anchor, 470 + 4 * 5.4, accuracy: 0.01)
    }

    func testFindsTheAtoColumnHeadings() {
        XCTAssertEqual(plan.headers.count, 3, "one per page of the table")
        XCTAssertTrue(plan.headers.allSatisfy { $0.font != nil })
    }

    // MARK: - Identity and figures

    func testOFPIdentity() throws {
        let identity = try XCTUnwrap(plan.identity)
        XCTAssertEqual(identity.route, "ALAICN01")
        XCTAssertEqual(identity.request, "83104")
        XCTAssertEqual(identity.issued, "13/08/2026 15:26Z")
        XCTAssertEqual(identity.summary, "ALAICN01  ·  REQ 83104  ·  13/08/2026 15:26Z")
    }

    func testKeyFiguresIgnoreTheMaximaPrintedAbove() throws {
        let figures = try XCTUnwrap(plan.figures)
        XCTAssertEqual(figures.tow, "145979", "not MTOW 187000 from the line above")
        XCTAssertEqual(figures.lw, "122928")
        XCTAssertEqual(figures.zfw, "116632")
        XCTAssertEqual(figures.pld, "22500")
        XCTAssertEqual(figures.ci, "CI027")
    }

    func testFlightTimes() throws {
        let times = try XCTUnwrap(plan.times)
        XCTAssertEqual(times.std, "0145")
        XCTAssertEqual(times.etd, "0155")
        XCTAssertEqual(times.sta, "0905")
        XCTAssertEqual(times.eta, "0915")
        XCTAssertEqual(times.trip, "05.10")
    }

    // MARK: - Document fields

    func testFindsTheDocumentBlanks() {
        let labels = plan.fields.map(\.label)
        XCTAssertTrue(labels.contains("ATIS"), "found: \(labels)")
        XCTAssertTrue(labels.contains("ATC CLRNC"))
        XCTAssertTrue(labels.contains("PIC BLOCK"))
        XCTAssertTrue(labels.contains("REASON FOR EXTRA FUEL"))
        XCTAssertTrue(labels.contains("ALTM1"))
        XCTAssertTrue(labels.contains("STBY"))
        XCTAssertTrue(labels.contains("ALTM2"))
    }

    func testPicBlockCarriesThePlannedBlockFuel() throws {
        let field = try XCTUnwrap(plan.fields.first { $0.label == "PIC BLOCK" })
        XCTAssertEqual(field.reference, "29647",
                       "the figure printed just left of the blank, never written back")
    }

    func testFreeTextFieldsGrowBeyondTheirDots() throws {
        let clearance = try XCTUnwrap(plan.fields.first { $0.label == "ATC CLRNC" })
        XCTAssertGreaterThan(clearance.capacity, 13,
                             "the blank is 13 dots but the line and the one below are free")
        XCTAssertGreaterThan(clearance.segments.count, 1, "it continues onto the spare line")

        let reason = try XCTUnwrap(plan.fields.first { $0.label == "REASON FOR EXTRA FUEL" })
        XCTAssertGreaterThan(reason.capacity, 13)
    }

    func testShortNumericFieldsAreLeftAlone() throws {
        let altm1 = try XCTUnwrap(plan.fields.first { $0.label == "ALTM1" })
        XCTAssertEqual(altm1.capacity, 5, "an altimeter box keeps exactly the room the form gives it")
        XCTAssertEqual(altm1.segments.count, 1)
    }

    func testFieldsSharingALineAreGrouped() {
        let onOneLine = plan.fields.filter { ["ALTM1", "STBY", "ALTM2"].contains($0.label) }
        XCTAssertEqual(onOneLine.count, 3)
        let bases = Set(onOneLine.compactMap { $0.segments.first?.base })
        XCTAssertEqual(bases.count, 1, "all three sit on the same line of the form")
    }

    // MARK: - ICAO flight plan

    func testReassemblesTheIcaoPlanAcrossThePageBreak() throws {
        let icao = try XCTUnwrap(plan.icao)
        XCTAssertTrue(icao.split, "it is printed across two pages")
        XCTAssertEqual(icao.pages, [5, 6])
        XCTAssertTrue(icao.lines.contains { $0.hasPrefix("(FPL-KC937") })
        XCTAssertTrue(icao.lines.contains { $0.contains("RKSI0710") })
        XCTAssertFalse(icao.oneLine.contains("AIR ASTANA BRIEF"), "the page header is stripped")
        XCTAssertFalse(icao.oneLine.contains("PAGE 6 OF 8"), "and so is the footer")
        // A continuation line folds into the field it belongs to.
        XCTAssertTrue(icao.lines.allSatisfy { $0.hasPrefix("-") || $0.hasPrefix("(") })
    }

    // MARK: - Weather and NOTAMs

    func testGroupsReportsByAerodrome() throws {
        let codes = plan.airports.map(\.icao)
        XCTAssertEqual(Set(codes), ["UAAA", "RKSI", "UTTT"])

        let almaty = try XCTUnwrap(plan.airports.first { $0.icao == "UAAA" })
        XCTAssertEqual(almaty.iata, "ALA")
        XCTAssertEqual(almaty.name, "ALMATY INTL")
        XCTAssertEqual(almaty.role, "departure")
        XCTAssertEqual(almaty.group, .flight)
        XCTAssertEqual(almaty.metar.count, 1)
        XCTAssertEqual(almaty.taf.count, 1)
        XCTAssertEqual(almaty.notams.count, 2)
        XCTAssertEqual(almaty.company.count, 2, "one of its own and one shared with Incheon")
    }

    func testMultiLineTafIsJoined() throws {
        let almaty = try XCTUnwrap(plan.airports.first { $0.icao == "UAAA" })
        let taf = try XCTUnwrap(almaty.taf.first)
        XCTAssertTrue(taf.contains("1306/1406"))
        XCTAssertTrue(taf.contains("TEMPO 1312/1318"), "the continuation line belongs to the TAF")
        XCTAssertFalse(taf.hasSuffix("="), "the bulletin terminator is dropped")
    }

    func testNotamValidityAndSubject() throws {
        let almaty = try XCTUnwrap(plan.airports.first { $0.icao == "UAAA" })
        let ils = try XCTUnwrap(almaty.notams.first { $0.id == "A3725/26" })
        XCTAssertEqual(ils.from, "30JUN0500")
        XCTAssertEqual(ils.to, "30SEP0500")
        XCTAssertFalse(ils.estimated)
        XCTAssertEqual(ils.subject, "ILS III", "the short line above the item titles it")
        XCTAssertTrue(ils.text.contains("CAT III NOT AVBL"))

        let taxiway = try XCTUnwrap(almaty.notams.first { $0.id == "A4947/26" })
        XCTAssertTrue(taxiway.estimated, "the trailing EST is lifted out of the validity")
        XCTAssertEqual(taxiway.to, "31AUG2359")
    }

    func testRouteCompanyNotamBelongsToBothEnds() throws {
        let almaty = try XCTUnwrap(plan.airports.first { $0.icao == "UAAA" })
        let incheon = try XCTUnwrap(plan.airports.first { $0.icao == "RKSI" })
        XCTAssertTrue(almaty.company.contains { $0.id == "UAAA-RKSI-00002" })
        XCTAssertTrue(incheon.company.contains { $0.id == "UAAA-RKSI-00002" })
        XCTAssertTrue(almaty.company.contains { $0.id == "UAAA-00001" })
        XCTAssertFalse(incheon.company.contains { $0.id == "UAAA-00001" },
                       "a single-aerodrome company NOTAM stays where it belongs")
    }

    func testCompanyNotamValidity() throws {
        let almaty = try XCTUnwrap(plan.airports.first { $0.icao == "UAAA" })
        let item = try XCTUnwrap(almaty.company.first { $0.id == "UAAA-00001" })
        XCTAssertEqual(item.from, "28MAY2025")
        XCTAssertEqual(item.to, "PERM")
        XCTAssertTrue(item.text.contains("DE-ICING"))
    }

    func testAerodromeWithNoPartInTheFlightIsGroupedApart() throws {
        let tashkent = try XCTUnwrap(plan.airports.first { $0.icao == "UTTT" })
        XCTAssertNil(tashkent.role, "\"OTHER:\" names it without giving it a role")
        XCTAssertEqual(tashkent.group, .other)
        XCTAssertEqual(tashkent.metar.count, 1)
    }

    func testDepartureSortsFirst() {
        XCTAssertEqual(plan.airports.first?.icao, "UAAA")
    }

    // MARK: - Charts

    func testFindsTheFullPageCharts() {
        XCTAssertEqual(plan.charts.count, 2)
        XCTAssertEqual(plan.charts.map(\.page), [6, 7])
        XCTAssertEqual(plan.charts[0].width, 640)
        XCTAssertEqual(plan.charts[1].width, 800)
    }

    func testTextPagesAreNotMistakenForCharts() {
        XCTAssertFalse(plan.charts.contains { $0.page <= 5 })
    }

    // MARK: - Display helpers

    func testValidityStamp() {
        XCTAssertEqual(Notam.stamp("30JUN0500"), "30JUN 0500Z")
        XCTAssertEqual(Notam.stamp("PERM"), "PERM")
        XCTAssertEqual(Notam.stamp("WIE"), "WIE")
    }

    func testValidityLineAsShown() throws {
        let almaty = try XCTUnwrap(plan.airports.first { $0.icao == "UAAA" })
        let ils = try XCTUnwrap(almaty.notams.first { $0.id == "A3725/26" })
        XCTAssertEqual(ils.validityText, "30JUN 0500Z → 30SEP 0500Z")

        let taxiway = try XCTUnwrap(almaty.notams.first { $0.id == "A4947/26" })
        XCTAssertEqual(taxiway.validityText, "01AUG 0000Z → 31AUG 2359Z EST")
    }

    func testRunTogetherKeywordIsSpaced() {
        XCTAssertEqual(WeatherReader.spaced("SPECIZWYN 130800Z"), "SPECI ZWYN 130800Z")
        XCTAssertEqual(WeatherReader.spaced("METAR UAAA 130800Z"), "METAR UAAA 130800Z")
    }
}
