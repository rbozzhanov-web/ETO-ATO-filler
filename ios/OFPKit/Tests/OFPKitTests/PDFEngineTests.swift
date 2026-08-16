import XCTest
@testable import OFPKit

func loadFixture(_ name: String) throws -> [UInt8] {
    let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("Fixtures")
    return [UInt8](try Data(contentsOf: dir.appendingPathComponent(name)))
}

final class PDFEngineTests: XCTestCase {

    private func document() throws -> PDFMiniDocument {
        try PDFMiniDocument(bytes: loadFixture("synthetic-ofp.pdf"))
    }

    func testReadsXrefAndTrailer() throws {
        let doc = try document()
        XCTAssertFalse(doc.xref.isEmpty)
        XCTAssertNotNil(doc.trailer["Root"]?.refValue)
        XCTAssertNotNil(doc.trailer["Size"]?.intValue)
        XCTAssertEqual(doc.trailer["ID"]?.arrayValue?.count, 2)
    }

    func testWalksThePageTree() throws {
        let doc = try document()
        let pages = doc.pages()
        XCTAssertEqual(pages.count, 8)
        for page in pages {
            XCTAssertGreaterThan(page.ref, 0)
            XCTAssertEqual(page.mediaBox, [0, 0, 612, 792])
            XCTAssertNotNil(page.resources?["Font"], "every page inherits the Courier font")
        }
    }

    func testExtractsTextWithCoordinates() throws {
        let doc = try document()
        let items = PDFText.items(in: try doc.content(of: doc.pages()[0]))
        XCTAssertFalse(items.isEmpty)

        let joined = items.map(\.text).joined(separator: "\n")
        XCTAssertTrue(joined.contains("ROUTE ID: ALAICN01"))
        XCTAssertTrue(joined.contains("TOW 145979"))
        XCTAssertTrue(joined.contains("PIC BLOCK"))

        // The advance is Courier's 0.6 em, which is what all the column arithmetic rests on.
        for item in items {
            XCTAssertEqual(item.size, 9.0, accuracy: 0.001)
            XCTAssertEqual(item.cw, 9.0 * 0.6, accuracy: 0.001)
        }

        // The four columns of the STD/ETD/STA/ETA header land where they were written.
        let std = items.first { $0.text == "STD" }
        let eta = items.first { $0.text == "ETA" }
        XCTAssertNotNil(std)
        XCTAssertNotNil(eta)
        XCTAssertEqual(std!.x, 30 + 10 * 5.4, accuracy: 0.01)
        XCTAssertEqual(eta!.x, 30 + 40 * 5.4, accuracy: 0.01)
        XCTAssertEqual(std!.y, eta!.y, accuracy: 0.01, "one line, so one baseline")
    }

    func testFindsTheDottedEtoColumn() throws {
        let doc = try document()
        let items = PDFText.items(in: try doc.content(of: doc.pages()[1]))
        let dotRuns = items.filter { $0.text == "...." }
        XCTAssertEqual(dotRuns.count, 16, "eight waypoints, an ETO and an ATO row each")
        for run in dotRuns {
            XCTAssertEqual(run.x, 470, accuracy: 0.01)
        }
    }

    func testDecodesFlateAndDCTImages() throws {
        let doc = try document()

        let flatePage = doc.pages()[6]
        let xobjects = doc.resolve(flatePage.resources?["XObject"])?.dictValue
        let flate = doc.resolve(xobjects?["Im0"])?.streamValue
        XCTAssertNotNil(flate)
        XCTAssertEqual(doc.resolve(flate?.dict["Width"])?.intValue, 640)
        let pixels = try doc.streamData(flate!)
        XCTAssertEqual(pixels.count, 640 * 480, "one byte per pixel, indexed colour")

        // A DCTDecode image is handed over as the original JPEG bytes, never re-encoded.
        let jpegPage = doc.pages()[7]
        let jpegObjects = doc.resolve(jpegPage.resources?["XObject"])?.dictValue
        let jpeg = doc.resolve(jpegObjects?["Im1"])?.streamValue
        XCTAssertNotNil(jpeg)
        let raw = Array(doc.bytes[jpeg!.start..<(jpeg!.start + jpeg!.length)])
        XCTAssertEqual(Array(raw.prefix(2)), [0xFF, 0xD8], "starts with the JPEG marker")
        XCTAssertEqual(Array(raw.suffix(2)), [0xFF, 0xD9], "and ends with it")
    }

    // MARK: - Incremental update

    func testAppendLeavesTheOriginalBytesUntouched() throws {
        let doc = try document()
        var ops = PDFOps()
        ops.text(font: "FB", size: 9, x: 470, y: 700, "0210",
                 color: PDFColor(hex: "#0033cc"))

        let out = try PDFWriter.append(
            to: doc,
            perPage: [1: ops.finish()],
            fonts: [PDFFontResource(
                name: "FB",
                dictionary: "<</Type/Font/BaseFont/Courier-Bold/Encoding/StandardEncoding/Subtype/Type1>>")])

        XCTAssertGreaterThan(out.count, doc.bytes.count)
        XCTAssertEqual(Array(out.prefix(doc.bytes.count)), doc.bytes,
                       "an incremental update must not rewrite a single original byte")
        XCTAssertTrue(Latin1.string(out.suffix(32)).contains("%%EOF"))
    }

    func testAppendedFileStillParsesAndCarriesTheOverlay() throws {
        let doc = try document()
        var first = PDFOps()
        first.text(font: "FB", size: 9, x: 470, y: 700, "0210", color: PDFColor(hex: "#0033cc"))
        var second = PDFOps()
        second.text(font: "FB", size: 9, x: 470, y: 688, "0223", color: PDFColor(hex: "#00762e"))

        let out = try PDFWriter.append(
            to: doc,
            perPage: [1: first.finish(), 2: second.finish()],
            fonts: [PDFFontResource(
                name: "FB",
                dictionary: "<</Type/Font/BaseFont/Courier-Bold/Encoding/StandardEncoding/Subtype/Type1>>")])

        // Re-open the result: the new xref must win, and the pages must still be found.
        let reopened = try PDFMiniDocument(bytes: out)
        XCTAssertEqual(reopened.pages().count, 8)

        let page2 = PDFText.items(in: try reopened.content(of: reopened.pages()[1]))
        XCTAssertTrue(page2.contains { $0.text == "0210" }, "the overlay is on page 2")
        XCTAssertTrue(page2.contains { $0.text == "ALMATY" }, "and the original text survives")

        let page3 = PDFText.items(in: try reopened.content(of: reopened.pages()[2]))
        XCTAssertTrue(page3.contains { $0.text == "0223" })

        // The font was added to the pages that needed it.
        let fonts = reopened.resolve(reopened.pages()[1].resources?["Font"])?.dictValue
        XCTAssertNotNil(fonts?["FB"])
        XCTAssertNotNil(fonts?["F1"], "and the form's own font is still there")

        // A page the overlay never touched keeps its original content object.
        let untouched = PDFText.items(in: try reopened.content(of: reopened.pages()[0]))
        XCTAssertTrue(untouched.contains { $0.text.contains("ROUTE ID") })
    }

    func testAppendIsRepeatable() throws {
        // Saving twice in a flight is normal; the second update stacks on the first.
        let doc = try document()
        var ops = PDFOps()
        ops.text(font: "FB", size: 9, x: 100, y: 700, "FIRST", color: PDFColor(hex: "#000000"))
        let once = try PDFWriter.append(to: doc, perPage: [0: ops.finish()], fonts: [
            PDFFontResource(name: "FB", dictionary: "<</Type/Font/BaseFont/Courier-Bold/Subtype/Type1>>")])

        let second = try PDFMiniDocument(bytes: once)
        var more = PDFOps()
        more.text(font: "FB", size: 9, x: 100, y: 688, "SECOND", color: PDFColor(hex: "#000000"))
        let twice = try PDFWriter.append(to: second, perPage: [0: more.finish()], fonts: [
            PDFFontResource(name: "FB", dictionary: "<</Type/Font/BaseFont/Courier-Bold/Subtype/Type1>>")])

        let final = try PDFMiniDocument(bytes: twice)
        let text = PDFText.items(in: try final.content(of: final.pages()[0])).map(\.text)
        XCTAssertTrue(text.contains("FIRST"))
        XCTAssertTrue(text.contains("SECOND"))
    }

    // MARK: - Operator formatting

    func testNumberFormattingMatchesJavaScript() {
        XCTAssertEqual(PDFOps.num(12), "12")
        XCTAssertEqual(PDFOps.num(12.5), "12.5")
        XCTAssertEqual(PDFOps.num(12.0004), "12")
        XCTAssertEqual(PDFOps.num(12.3456), "12.346")
        XCTAssertEqual(PDFOps.num(-0.4), "-0.4")
        XCTAssertEqual(PDFOps.num(0), "0")
        // Math.round is round-half-up, not round-half-away-from-zero.
        XCTAssertEqual(PDFOps.num(-0.0005), "0")
        XCTAssertEqual(PDFOps.num(0.0005), "0.001")
    }

    func testStringEscaping() {
        XCTAssertEqual(Latin1.string(PDFOps.escape("A(B)C")), #"A\(B\)C"#)
        XCTAssertEqual(Latin1.string(PDFOps.escape(#"back\slash"#)), #"back\\slash"#)
        XCTAssertEqual(Latin1.string(PDFOps.escape("PLAIN")), "PLAIN")
    }

    func testColourFromHex() {
        let blue = PDFColor(hex: "#0033cc")
        XCTAssertEqual(blue.r, 0, accuracy: 0.0001)
        XCTAssertEqual(blue.g, 0.2, accuracy: 0.0001)
        XCTAssertEqual(blue.b, 0.8, accuracy: 0.0001)
    }

    func testRejectsUnsupportedDocuments() {
        XCTAssertThrowsError(try PDFMiniDocument(bytes: Array("not a pdf at all".utf8)))
        XCTAssertThrowsError(try PDFMiniDocument(bytes: []))
    }
}
