import Foundation

/// One value out of a PDF file.
///
/// `endMarker` is the Swift stand-in for the JavaScript `undefined` the original lexer
/// returned when it walked onto a closing `]` or `>`; `nil` from the lexer stands for its
/// `null`. Keeping the two apart matters — arrays stop on one and content streams skip
/// the other.
public indirect enum PDFObject {
    case null
    case bool(Bool)
    case number(Double)
    case name(String)
    case string([UInt8])
    case array([PDFObject])
    case dict([String: PDFObject])
    /// An indirect reference `N G R`, collapsed to its object number.
    case ref(Int)
    /// A content-stream operator, or any bare keyword the lexer did not recognise.
    case op(String)
    case stream(PDFStream)
    case endMarker
}

/// A stream object: its dictionary plus where the raw bytes sit in the file. The data is
/// not read until asked for, which keeps loading a package cheap — chart bitmaps are only
/// inflated when the crew opens them.
public struct PDFStream {
    public let dict: [String: PDFObject]
    public let start: Int
    public let length: Int
}

public extension PDFObject {
    var numberValue: Double? { if case .number(let d) = self { return d }; return nil }

    var intValue: Int? {
        guard case .number(let d) = self, d.isFinite else { return nil }
        return Int(d)
    }

    var nameValue: String? { if case .name(let n) = self { return n }; return nil }
    var arrayValue: [PDFObject]? { if case .array(let a) = self { return a }; return nil }
    var stringBytes: [UInt8]? { if case .string(let b) = self { return b }; return nil }
    var refValue: Int? { if case .ref(let n) = self { return n }; return nil }
    var streamValue: PDFStream? { if case .stream(let s) = self { return s }; return nil }

    /// Streams answer with their own dictionary, so `/Subtype` and friends can be read off
    /// either shape without the caller unwrapping first.
    var dictValue: [String: PDFObject]? {
        switch self {
        case .dict(let d): return d
        case .stream(let s): return s.dict
        default: return nil
        }
    }

    subscript(key: String) -> PDFObject? { dictValue?[key] }
}
