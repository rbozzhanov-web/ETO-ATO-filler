import Foundation

/// A thin wrapper over `NSRegularExpression`.
///
/// Swift 5.7's built-in `Regex` would be tidier, but the patterns here are ported verbatim
/// from the JavaScript and `NSRegularExpression` speaks the same ICU dialect, so a
/// character class that worked there works here. It is also available on every platform
/// this package is built for, which the tests depend on.
struct Pattern {
    private let regex: NSRegularExpression
    let source: String

    init(_ pattern: String, caseInsensitive: Bool = false) {
        source = pattern
        // The patterns are literals in this file; a typo should fail loudly in tests
        // rather than silently never match.
        regex = try! NSRegularExpression(
            pattern: pattern,
            options: caseInsensitive ? [.caseInsensitive] : [])
    }

    func matches(_ s: String) -> Bool {
        regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// Capture groups of the first match; index 0 is the whole match. A group that did not
    /// participate comes back as `nil`, exactly like JavaScript's `undefined`.
    func first(_ s: String) -> [String?]? {
        guard let m = regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else {
            return nil
        }
        return (0..<m.numberOfRanges).map { index in
            guard let r = Range(m.range(at: index), in: s) else { return nil }
            return String(s[r])
        }
    }

    func all(_ s: String) -> [[String?]] {
        regex.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { m in
            (0..<m.numberOfRanges).map { index in
                guard let r = Range(m.range(at: index), in: s) else { return nil }
                return String(s[r])
            }
        }
    }
}
