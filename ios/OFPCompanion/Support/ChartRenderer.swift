import CoreGraphics
import Foundation
import UIKit
import OFPKit

/// Turns a chart page's image XObject into something the screen can show.
///
/// The bytes are taken straight out of the PDF: a JPEG is handed to the system untouched,
/// and a bitmap is wrapped rather than re-encoded. Decoding happens the first time a chart
/// is opened, not while the plan is loading — a 1800×1451 sheet is not free, and the crew
/// is waiting on the table, not on the pictures.
enum ChartRenderer {

    private static var cache: [String: UIImage] = [:]
    /// Decoding happens on a background task, so the cache is reached from more than one
    /// thread and needs guarding.
    private static let lock = NSLock()

    static func image(document: PDFMiniDocument, chart: ChartPage) -> UIImage? {
        let cacheKey = "\(chart.page)/\(chart.key)"
        lock.lock()
        let cached = cache[cacheKey]
        lock.unlock()
        if let cached { return cached }

        guard let rendered = decode(document: document, chart: chart) else { return nil }
        lock.lock()
        cache[cacheKey] = rendered
        lock.unlock()
        return rendered
    }

    private static func decode(document: PDFMiniDocument, chart: ChartPage) -> UIImage? {
        let pages = document.pages()
        guard chart.page < pages.count,
              let xobjects = document.resolve(pages[chart.page].resources?["XObject"])?.dictValue,
              let stream = document.resolve(xobjects[chart.key])?.streamValue else { return nil }

        let filter = document.resolve(stream.dict["Filter"])
        let filterName = filter?.nameValue ?? filter?.arrayValue?.first?.nameValue

        // A JPEG is already a picture; nothing is gained by unpacking and repacking it.
        if filterName == "DCTDecode" {
            let end = min(stream.start + stream.length, document.bytes.count)
            guard stream.start < end else { return nil }
            return UIImage(data: Data(document.bytes[stream.start..<end]))
        }
        guard filterName == "FlateDecode" || filterName == "Fl" else { return nil }
        guard let data = try? document.streamData(stream) else { return nil }

        let width = chart.width
        let height = chart.height
        let colourSpace = document.resolve(stream.dict["ColorSpace"])

        var rgb = [UInt8]()
        rgb.reserveCapacity(width * height * 3)

        if let array = colourSpace?.arrayValue, array.first?.nameValue == "Indexed" {
            // One byte per pixel, looked up in the palette carried by the colour space.
            guard array.count >= 4 else { return nil }
            let lookup = array[3]
            var palette: [UInt8] = []
            if let literal = lookup.stringBytes {
                palette = literal
            } else if let paletteStream = document.resolve(lookup)?.streamValue,
                      let decoded = try? document.streamData(paletteStream) {
                palette = decoded
            }
            guard !palette.isEmpty else { return nil }
            guard data.count >= width * height else { return nil }

            for i in 0..<(width * height) {
                let entry = Int(data[i]) * 3
                if entry + 2 < palette.count {
                    rgb.append(palette[entry])
                    rgb.append(palette[entry + 1])
                    rgb.append(palette[entry + 2])
                } else {
                    rgb.append(contentsOf: [0, 0, 0])
                }
            }
        } else if colourSpace?.nameValue == "DeviceRGB" {
            guard data.count >= width * height * 3 else { return nil }
            rgb = Array(data[0..<(width * height * 3)])
        } else {
            return nil
        }

        guard let provider = CGDataProvider(data: Data(rgb) as CFData),
              let cgImage = CGImage(
                width: width, height: height,
                bitsPerComponent: 8, bitsPerPixel: 24,
                bytesPerRow: width * 3,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                provider: provider, decode: nil,
                shouldInterpolate: true, intent: .defaultIntent)
        else { return nil }

        return UIImage(cgImage: cgImage)
    }
}
