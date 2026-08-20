import UIKit
import OFPKit

/// Draws the Journey Log onto paper.
///
/// The web version hands the sheet to the browser's print dialogue; here it is drawn into a
/// PDF and given to the share sheet, which is the same act on a device with no printer
/// dialogue of its own. Both read the one layout, so what is on the screen is what comes
/// out — to the point.
enum JourneyLogPrinter {

    /// The form is set in 7.5pt type.
    static let baseSize: CGFloat = 7.5
    /// Anything that will not fit is set down a little, but never past this — below it a
    /// column has lost the argument and would be unreadable anyway.
    static let minimumScale: CGFloat = 0.6

    static func render(document: JourneyLogDocument) -> Data {
        let size = CGSize(width: JourneyLogForm.pageWidth, height: JourneyLogForm.pageHeight)
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: size))

        return renderer.pdfData { context in
            for index in document.pages.indices {
                context.beginPage()
                draw(document: document, page: index, in: context.cgContext)
            }
        }
    }

    private static func draw(document: JourneyLogDocument, page index: Int, in cg: CGContext) {
        let sheet = JourneyLogLayout.build(document: document, page: index)

        // The bands first, so the ruling sits on top of them.
        for band in sheet.bands {
            cg.setFillColor(UIColor(white: band.light ? 0.92 : 0.85, alpha: 1).cgColor)
            cg.fill(CGRect(x: band.x, y: band.y, width: band.width, height: band.height))
        }
        cg.setFillColor(UIColor.black.cgColor)
        for rule in sheet.rules {
            cg.fill(CGRect(x: rule.x, y: rule.y, width: rule.width, height: rule.height))
        }

        for caption in sheet.captions where !caption.text.isEmpty {
            drawText(caption.text,
                     in: CGRect(x: caption.x, y: caption.y,
                                width: caption.sizesToText ? .greatestFiniteMagnitude : caption.width,
                                height: caption.height),
                     bold: caption.bold,
                     align: caption.sizesToText ? .leading : caption.align,
                     colour: .black)
        }

        for field in sheet.fields {
            let text = document.value(page: index, table: field.table,
                                      row: field.row, key: field.key)
            guard !text.isEmpty else { continue }
            drawText(text,
                     in: CGRect(x: field.x, y: field.y, width: field.width, height: field.height),
                     bold: false, align: field.align,
                     // What the document came printed with is a record; what the crew wrote
                     // is an entry. On paper they are both simply ink.
                     colour: .black)
        }
    }

    private static func drawText(_ text: String, in rect: CGRect, bold: Bool,
                                 align: JourneyLogLayout.Align, colour: UIColor) {
        var size = baseSize
        var attributes: [NSAttributedString.Key: Any] = [
            .font: bold ? UIFont.boldSystemFont(ofSize: size) : UIFont.systemFont(ofSize: size),
            .foregroundColor: colour
        ]

        // Whatever the device puts in Calibri's place is usually wider, and a long name
        // would run out of its cell. Anything that does not fit is set down until it does.
        if rect.width.isFinite {
            var measured = (text as NSString).size(withAttributes: attributes)
            while measured.width > rect.width, size > baseSize * minimumScale {
                size -= 0.25
                attributes[.font] = bold ? UIFont.boldSystemFont(ofSize: size)
                                         : UIFont.systemFont(ofSize: size)
                measured = (text as NSString).size(withAttributes: attributes)
            }
        }

        let measured = (text as NSString).size(withAttributes: attributes)
        let width = rect.width.isFinite ? rect.width : measured.width
        let x = align == .centre ? rect.minX + max(0, (width - measured.width) / 2)
                                 : rect.minX + 1
        let y = rect.minY + max(0, (rect.height - measured.height) / 2)
        (text as NSString).draw(at: CGPoint(x: x, y: y), withAttributes: attributes)
    }
}
