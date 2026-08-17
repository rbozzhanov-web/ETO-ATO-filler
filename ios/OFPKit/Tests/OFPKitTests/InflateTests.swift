import XCTest
@testable import OFPKit

/// The fixtures are produced by Python's zlib at every compression level, including the
/// level-0 stored blocks and a highly repetitive input that forces long back-references,
/// so all three block types and both Huffman trees are exercised.
final class InflateTests: XCTestCase {

    private func fixture(_ name: String) throws -> (input: [UInt8], expected: [UInt8]) {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
        let comp = try Data(contentsOf: dir.appendingPathComponent("\(name).z"))
        let plain = try Data(contentsOf: dir.appendingPathComponent("\(name).bin"))
        return ([UInt8](comp), [UInt8](plain))
    }

    private func check(_ name: String) throws {
        let f = try fixture(name)
        let got = try Inflate.decode(f.input)
        XCTAssertEqual(got.count, f.expected.count, "\(name): wrong length")
        XCTAssertEqual(got, f.expected, "\(name): bytes differ")
    }

    func testStoredBlocks() throws { try check("level0") }
    func testFastCompression() throws { try check("level1") }
    func testDefaultCompression() throws { try check("level6") }
    func testMaxCompression() throws { try check("level9") }
    func testHighlyRepetitive() throws { try check("repetitive") }
    func testRandomIncompressible() throws { try check("random") }
    func testPDFContentStream() throws { try check("contentstream") }

    func testEmptyInput() throws {
        let f = try fixture("empty")
        XCTAssertEqual(try Inflate.decode(f.input), [])
    }

    func testRawDeflateWithoutZlibHeader() throws {
        let f = try fixture("rawdeflate")
        XCTAssertEqual(try Inflate.decode(f.input), f.expected)
    }

    func testTruncatedStreamThrows() throws {
        let f = try fixture("level6")
        for fraction in [2, 3, 5, 9, 40] {
            let cut = Array(f.input.prefix(f.input.count / fraction))
            XCTAssertThrowsError(try Inflate.decode(cut), "prefix 1/\(fraction) should not decode")
        }
    }

    /// A damaged plan must produce the app's "could not parse" message, never a crash in
    /// the cockpit. Corruption is applied to a real stream so the decoder gets far enough
    /// in to reach the interesting paths.
    func testCorruptStreamsThrowRatherThanTrap() throws {
        let f = try fixture("level6")
        var seed: UInt64 = 0x9E3779B97F4A7C15
        func next() -> UInt64 {
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17
            return seed
        }
        for _ in 0..<300 {
            var bytes = f.input
            for _ in 0..<(1 + Int(next() % 12)) {
                bytes[Int(next() % UInt64(bytes.count))] = UInt8(next() % 256)
            }
            // Either outcome is fine — decoded bytes or a thrown error. Trapping is not.
            _ = try? Inflate.decode(bytes)
        }
    }

    func testGarbageThrows() throws {
        XCTAssertThrowsError(try Inflate.decode([]))
        XCTAssertThrowsError(try Inflate.decode([0xFF]))
        XCTAssertThrowsError(try Inflate.decode([0x78, 0x9C, 0xFF, 0xFF, 0xFF, 0xFF]))
    }
}
