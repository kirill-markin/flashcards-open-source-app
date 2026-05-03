import Foundation

private let isoTimestampUtcCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    guard let timeZone = TimeZone(secondsFromGMT: 0) else {
        preconditionFailure("UTC time zone is unavailable")
    }
    calendar.timeZone = timeZone
    return calendar
}()

func formatIsoTimestamp(date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func parseIsoTimestamp(value: String) -> Date? {
    parseStrictIsoTimestamp(value: value)
}

func parseStrictIsoTimestamp(value: String) -> Date? {
    let bytes = Array(value.utf8)
    guard bytes.count == 20 || bytes.count > 21 else {
        return nil
    }
    guard bytes[4] == CharacterCode.hyphen.rawValue,
          bytes[7] == CharacterCode.hyphen.rawValue,
          bytes[10] == CharacterCode.uppercaseT.rawValue,
          bytes[13] == CharacterCode.colon.rawValue,
          bytes[16] == CharacterCode.colon.rawValue else {
        return nil
    }

    let year = parseFixedAsciiDigits(bytes: bytes, offset: 0, count: 4)
    let month = parseFixedAsciiDigits(bytes: bytes, offset: 5, count: 2)
    let day = parseFixedAsciiDigits(bytes: bytes, offset: 8, count: 2)
    let hour = parseFixedAsciiDigits(bytes: bytes, offset: 11, count: 2)
    let minute = parseFixedAsciiDigits(bytes: bytes, offset: 14, count: 2)
    let second = parseFixedAsciiDigits(bytes: bytes, offset: 17, count: 2)
    guard let year,
          let month,
          let day,
          let hour,
          let minute,
          let second,
          (1...12).contains(month),
          (1...31).contains(day),
          (0...23).contains(hour),
          (0...59).contains(minute),
          (0...59).contains(second) else {
        return nil
    }

    let millisecond: Int
    if bytes.count == 20 {
        guard bytes[19] == CharacterCode.uppercaseZ.rawValue else {
            return nil
        }
        millisecond = 0
    } else {
        guard bytes[19] == CharacterCode.period.rawValue,
              bytes[bytes.count - 1] == CharacterCode.uppercaseZ.rawValue else {
            return nil
        }
        let fractionBytes = Array(bytes[20..<(bytes.count - 1)])
        guard fractionBytes.isEmpty == false else {
            return nil
        }
        guard fractionBytes.allSatisfy({ byte in
            asciiDigitValue(byte: byte) != nil
        }) else {
            return nil
        }
        millisecond = parseFractionMilliseconds(bytes: fractionBytes)
    }

    var components = DateComponents()
    components.calendar = isoTimestampUtcCalendar
    components.timeZone = isoTimestampUtcCalendar.timeZone
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
    components.second = second
    components.nanosecond = millisecond * 1_000_000

    guard let date = isoTimestampUtcCalendar.date(from: components) else {
        return nil
    }

    let resolved = isoTimestampUtcCalendar.dateComponents(
        [.year, .month, .day, .hour, .minute, .second],
        from: date
    )
    guard resolved.year == year,
          resolved.month == month,
          resolved.day == day,
          resolved.hour == hour,
          resolved.minute == minute,
          resolved.second == second else {
        return nil
    }

    return date
}

func epochMillis(date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1_000).rounded())
}

func parseStrictIsoTimestampEpochMillis(value: String) -> Int64? {
    parseStrictIsoTimestamp(value: value).map { date in
        epochMillis(date: date)
    }
}

func canonicalIsoTimestampForSync(cardId: String, dueAt: String?) throws -> String? {
    guard let dueAt else {
        return nil
    }
    guard let dueAtDate = parseStrictIsoTimestamp(value: dueAt) else {
        throw LocalStoreError.validation("Card \(cardId) has invalid dueAt for sync: \(dueAt)")
    }

    return formatIsoTimestamp(date: dueAtDate)
}

func nowIsoTimestamp() -> String {
    formatIsoTimestamp(date: Date())
}

func dateByAddingMinutes(date: Date, minutes: Int) -> Date {
    Date(timeInterval: TimeInterval(minutes * 60), since: date)
}

func dateByAddingDays(date: Date, days: Int) -> Date {
    Date(timeInterval: TimeInterval(days * 86_400), since: date)
}

func formatOptionalIsoTimestampForDisplay(value: String?) -> String {
    guard let value else {
        return "new"
    }

    guard let date = parseIsoTimestamp(value: value) else {
        return value
    }

    return date.formatted(date: .abbreviated, time: .shortened)
}

private enum CharacterCode: UInt8 {
    case hyphen = 45
    case period = 46
    case colon = 58
    case uppercaseT = 84
    case uppercaseZ = 90
}

private func asciiDigitValue(byte: UInt8) -> Int? {
    guard byte >= 48 && byte <= 57 else {
        return nil
    }

    return Int(byte - 48)
}

private func parseFixedAsciiDigits(bytes: [UInt8], offset: Int, count: Int) -> Int? {
    guard offset >= 0 && count > 0 && offset + count <= bytes.count else {
        return nil
    }

    var value = 0
    for index in offset..<(offset + count) {
        guard let digit = asciiDigitValue(byte: bytes[index]) else {
            return nil
        }
        value = (value * 10) + digit
    }

    return value
}

private func parseFractionMilliseconds(bytes: [UInt8]) -> Int {
    let cappedDigitCount = min(bytes.count, 3)
    var value = 0
    for index in 0..<cappedDigitCount {
        guard let digit = asciiDigitValue(byte: bytes[index]) else {
            preconditionFailure("Fraction bytes must contain digits only")
        }
        value = (value * 10) + digit
    }

    if cappedDigitCount == 1 {
        return value * 100
    }
    if cappedDigitCount == 2 {
        return value * 10
    }

    return value
}
