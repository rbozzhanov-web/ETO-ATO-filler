import Foundation

/// Clock arithmetic, all of it in minutes past midnight UTC.
///
/// A flight crosses midnight often enough that every comparison here has to wrap, and
/// wrapping to ±12 hours rather than ±24 is what lets "three minutes before the hour" and
/// "three minutes after" be told apart without knowing the date.
public enum TimeMath {

    /// `0210` — four digits, anything else rejected. Punctuation is stripped first so that
    /// `02:10` is accepted from a paste.
    public static func parseTime(_ value: String) -> Int? {
        let digits = value.filter(\.isNumber)
        guard digits.count == 4 else { return nil }
        let h = Int(digits.prefix(2))!
        let m = Int(digits.suffix(2))!
        guard h <= 23, m <= 59 else { return nil }
        return h * 60 + m
    }

    /// Into 0…1439.
    public static func norm(_ minutes: Int) -> Int {
        ((minutes % 1440) + 1440) % 1440
    }

    /// `0210`, as the form prints it.
    public static func fmt(_ minutes: Int) -> String {
        let n = norm(minutes)
        return String(format: "%02d%02d", n / 60, n % 60)
    }

    /// `5.10` — hours and minutes, as the plan writes elapsed times.
    public static func hhmm(_ minutes: Int) -> String {
        "\(minutes / 60).\(String(format: "%02d", minutes % 60))"
    }

    /// A difference wrapped to ±12 hours, so a time either side of midnight reads as the
    /// few minutes it really is rather than as most of a day.
    public static func wrap(_ minutes: Int) -> Int {
        var m = minutes
        while m < -720 { m += 1440 }
        while m >= 720 { m -= 1440 }
        return m
    }

    /// Minutes past a due time: negative before it, zero or positive once it has come.
    public static func sinceDue(_ target: Int, now: Int) -> Int {
        wrap(now - norm(target))
    }

    /// The device clock as minutes past midnight UTC.
    public static func nowUTC(_ date: Date = Date()) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    /// `14:23:07` UTC, for the ticking clock above the table.
    public static func clockString(_ date: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.hour, .minute, .second], from: date)
        return String(format: "%02d:%02d:%02d",
                      parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
    }
}
