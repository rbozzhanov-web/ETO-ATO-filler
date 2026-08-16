import Foundation

/// PDF syntax is byte-oriented, and the original JavaScript leaned on that by holding
/// the whole file in a latin1 string where the string index *is* the byte offset. Swift
/// works on `[UInt8]` directly, which gives the same property without the conversion —
/// these helpers exist only for the places where bytes have to be shown or matched as
/// text.
enum Latin1 {

    /// Bytes to a string, one byte to one scalar. Never fails: every byte 0…255 is a
    /// valid Latin-1 scalar, which is exactly why the PDF engine uses this and not UTF-8.
    @inlinable
    static func string<C: Collection>(_ bytes: C) -> String where C.Element == UInt8 {
        var s = String.UnicodeScalarView()
        s.reserveCapacity(bytes.count)
        for b in bytes { s.append(Unicode.Scalar(b)) }
        return String(s)
    }

    /// The inverse. Scalars above 255 are truncated to their low byte, matching the
    /// JavaScript `charCodeAt(i) & 255`.
    @inlinable
    static func bytes(_ s: String) -> [UInt8] {
        var out = [UInt8]()
        out.reserveCapacity(s.unicodeScalars.count)
        for u in s.unicodeScalars { out.append(UInt8(u.value & 0xFF)) }
        return out
    }
}

extension Array where Element == UInt8 {
    /// True when the bytes at `offset` are the ASCII of `text`. Used for the fixed
    /// keywords of PDF syntax — `obj`, `stream`, `trailer`, `xref`.
    @inlinable
    func matches(_ text: String, at offset: Int) -> Bool {
        let t = Array(text.utf8)
        guard offset >= 0, offset + t.count <= count else { return false }
        for k in 0..<t.count where self[offset + k] != t[k] { return false }
        return true
    }
}
