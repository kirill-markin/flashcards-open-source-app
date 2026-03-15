import Foundation

func localAISqlNormalizeWhitespace(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    var normalizedValue = ""
    var inString = false
    var pendingWhitespace = false
    let characters = Array(trimmedValue)
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            if pendingWhitespace, normalizedValue.isEmpty == false {
                normalizedValue.append(" ")
                pendingWhitespace = false
            }

            normalizedValue.append(character)
            if inString, nextCharacter == "'" {
                normalizedValue.append("'")
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            normalizedValue.append(character)
            index += 1
            continue
        }

        if character.isWhitespace {
            pendingWhitespace = true
            index += 1
            continue
        }

        if character == ";" {
            let remainingCharacters = characters[(index + 1)...]
            if remainingCharacters.allSatisfy(\.isWhitespace) {
                break
            }
        }

        if pendingWhitespace, normalizedValue.isEmpty == false {
            normalizedValue.append(" ")
            pendingWhitespace = false
        }

        normalizedValue.append(character)
        index += 1
    }

    return normalizedValue
}

func localAISqlSplitStatements(_ value: String) throws -> [String] {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue.isEmpty {
        return []
    }

    let characters = Array(trimmedValue)
    var statements: [String] = []
    var current: [Character] = []
    var inString = false
    var depth = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            current.append(character)
            if inString, nextCharacter == "'" {
                current.append("'")
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            current.append(character)
            index += 1
            continue
        }

        if character == "(" {
            depth += 1
            current.append(character)
            index += 1
            continue
        }

        if character == ")" {
            depth -= 1
            current.append(character)
            index += 1
            continue
        }

        if depth == 0, character == ";" {
            let statement = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
            let remainingCharacters = characters[(index + 1)...]
            let remainingValue = String(remainingCharacters).trimmingCharacters(in: .whitespacesAndNewlines)
            if statement.isEmpty {
                throw LocalStoreError.validation("SQL batch contains an empty statement")
            }

            statements.append(statement)
            current = []

            if remainingValue.isEmpty {
                break
            }

            index += 1
            continue
        }

        current.append(character)
        index += 1
    }

    let statement = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
    if statement.isEmpty == false {
        statements.append(statement)
    }

    return statements
}

func localAISqlUppercaseKeyword(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .uppercased()
}

func localAISqlFirstWord(_ value: String) -> String {
    let components = value.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
    guard let first = components.first else {
        return ""
    }
    return localAISqlUppercaseKeyword(String(first))
}

func localAISqlMatch(
    pattern: String,
    value: String
) -> [String]? {
    guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return nil
    }
    let fullRange = NSRange(value.startIndex..<value.endIndex, in: value)
    guard let match = expression.firstMatch(in: value, options: [], range: fullRange) else {
        return nil
    }

    var groups: [String] = []
    groups.reserveCapacity(match.numberOfRanges)
    for rangeIndex in 0..<match.numberOfRanges {
        let range = match.range(at: rangeIndex)
        if range.location == NSNotFound {
            groups.append("")
            continue
        }
        guard let stringRange = Range(range, in: value) else {
            groups.append("")
            continue
        }
        groups.append(String(value[stringRange]))
    }
    return groups
}

func localAISqlSeparatorMatches(
    characters: [Character],
    index: Int,
    separator: String
) -> Bool {
    let separatorCharacters = Array(separator.uppercased())
    if index + separatorCharacters.count > characters.count {
        return false
    }

    for offset in 0..<separatorCharacters.count {
        if String(characters[index + offset]).uppercased() != String(separatorCharacters[offset]) {
            return false
        }
    }

    return true
}

func localAISqlSplitTopLevel(
    value: String,
    separator: String
) -> [String] {
    let characters = Array(value)
    var parts: [String] = []
    var current: [Character] = []
    var inString = false
    var depth = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            current.append(character)
            if inString, nextCharacter == "'" {
                current.append("'")
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            current.append(character)
            index += 1
            continue
        }

        if character == "(" {
            depth += 1
            current.append(character)
            index += 1
            continue
        }

        if character == ")" {
            depth -= 1
            current.append(character)
            index += 1
            continue
        }

        if depth == 0, localAISqlSeparatorMatches(characters: characters, index: index, separator: separator) {
            let part = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
            if part.isEmpty == false {
                parts.append(part)
            }
            current = []
            index += separator.count
            continue
        }

        current.append(character)
        index += 1
    }

    let tail = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
    if tail.isEmpty == false {
        parts.append(tail)
    }

    return parts
}

func localAISqlSplitTopLevelByKeyword(
    value: String,
    keyword: String
) -> [String] {
    let characters = Array(value)
    let keywordCharacters = Array(keyword.uppercased())
    var parts: [String] = []
    var current: [Character] = []
    var inString = false
    var depth = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            current.append(character)
            if inString, nextCharacter == "'" {
                current.append("'")
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            current.append(character)
            index += 1
            continue
        }

        if character == "(" {
            depth += 1
            current.append(character)
            index += 1
            continue
        }

        if character == ")" {
            depth -= 1
            current.append(character)
            index += 1
            continue
        }

        let matchesKeyword = depth == 0
            && index + keywordCharacters.count <= characters.count
            && zip(keywordCharacters, characters[index..<(index + keywordCharacters.count)]).allSatisfy { left, right in
                String(left) == String(right).uppercased()
            }
        let precededByWhitespace = index == 0 || characters[index - 1].isWhitespace
        let followedByWhitespace = index + keywordCharacters.count >= characters.count
            || characters[index + keywordCharacters.count].isWhitespace

        if matchesKeyword, precededByWhitespace, followedByWhitespace {
            let part = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
            if part.isEmpty == false {
                parts.append(part)
            }
            current = []
            index += keywordCharacters.count
            continue
        }

        current.append(character)
        index += 1
    }

    let tail = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
    if tail.isEmpty == false {
        parts.append(tail)
    }

    return parts
}

struct LocalAISqlTopLevelClauseDefinition {
    let name: String
    let keyword: String
}

struct LocalAISqlTopLevelClauseMatch {
    let name: String
    let keyword: String
    let index: Int
}

private func localAISqlIsBoundaryCharacter(_ character: Character?) -> Bool {
    guard let character else {
        return true
    }

    return character.isWhitespace
}

func localAISqlFindTopLevelClauseMatches(
    value: String,
    definitions: [LocalAISqlTopLevelClauseDefinition]
) -> [LocalAISqlTopLevelClauseMatch] {
    let characters = Array(value)
    let sortedDefinitions = definitions.sorted { left, right in
        left.keyword.count > right.keyword.count
    }
    var matches: [LocalAISqlTopLevelClauseMatch] = []
    var inString = false
    var depth = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            if inString, nextCharacter == "'" {
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            index += 1
            continue
        }

        if character == "(" {
            depth += 1
            index += 1
            continue
        }

        if character == ")" {
            depth -= 1
            index += 1
            continue
        }

        if depth != 0 {
            index += 1
            continue
        }

        let matchedDefinition = sortedDefinitions.first { definition in
            let keywordCharacters = Array(definition.keyword.uppercased())
            guard index + keywordCharacters.count <= characters.count else {
                return false
            }

            let matchesKeyword = zip(keywordCharacters, characters[index..<(index + keywordCharacters.count)]).allSatisfy { left, right in
                String(left) == String(right).uppercased()
            }
            guard matchesKeyword else {
                return false
            }

            let previousCharacter = index > 0 ? characters[index - 1] : nil
            let nextBoundaryCharacter = index + keywordCharacters.count < characters.count ? characters[index + keywordCharacters.count] : nil
            return localAISqlIsBoundaryCharacter(previousCharacter) && localAISqlIsBoundaryCharacter(nextBoundaryCharacter)
        }

        guard let matchedDefinition else {
            index += 1
            continue
        }

        matches.append(
            LocalAISqlTopLevelClauseMatch(
                name: matchedDefinition.name,
                keyword: matchedDefinition.keyword,
                index: index
            )
        )
        index += matchedDefinition.keyword.count
    }

    return matches
}

func localAISqlExtractTopLevelClauses(
    value: String,
    definitions: [LocalAISqlTopLevelClauseDefinition],
    context: String
) throws -> (leadingSegment: String, clauseValues: [String: String]) {
    let matches = localAISqlFindTopLevelClauseMatches(value: value, definitions: definitions)
    if matches.isEmpty {
        return (value.trimmingCharacters(in: .whitespacesAndNewlines), [:])
    }

    let definitionOrder = Dictionary(uniqueKeysWithValues: definitions.enumerated().map { index, definition in
        (definition.name, index)
    })
    var clauseValues: [String: String] = [:]
    var lastOrder = -1

    for (index, match) in matches.enumerated() {
        if clauseValues[match.name] != nil {
            throw LocalStoreError.validation("Duplicate \(context) clause: \(match.keyword)")
        }

        guard let order = definitionOrder[match.name] else {
            throw LocalStoreError.validation("Unknown \(context) clause: \(match.keyword)")
        }
        if order < lastOrder {
            throw LocalStoreError.validation("Invalid \(context) clause order near \(match.keyword)")
        }

        let nextIndex = index + 1 < matches.count ? matches[index + 1].index : value.count
        let clauseStart = value.index(value.startIndex, offsetBy: match.index + match.keyword.count)
        let clauseEnd = value.index(value.startIndex, offsetBy: nextIndex)
        clauseValues[match.name] = String(value[clauseStart..<clauseEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
        lastOrder = order
    }

    let leadingEnd = value.index(value.startIndex, offsetBy: matches[0].index)
    return (String(value[..<leadingEnd]).trimmingCharacters(in: .whitespacesAndNewlines), clauseValues)
}

func localAISqlParseSimpleNumberClauseValue(
    _ value: String?,
    keyword: String
) throws -> Int? {
    guard let value else {
        return nil
    }

    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.range(of: #"^\d+$"#, options: .regularExpression) != nil else {
        throw LocalStoreError.validation("\(keyword) must be a non-negative integer")
    }

    return Int(trimmedValue)
}

func localAISqlParseStringLiteral(_ value: String) throws -> String {
    guard value.hasPrefix("'"), value.hasSuffix("'") else {
        throw LocalStoreError.validation("Expected a quoted string literal")
    }
    return String(value.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
}

func localAISqlParseLiteral(_ value: String) throws -> LocalAISqlLiteralValue {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue.uppercased() == "NULL" {
        return .null
    }
    if trimmedValue.uppercased() == "TRUE" {
        return .boolean(true)
    }
    if trimmedValue.uppercased() == "FALSE" {
        return .boolean(false)
    }
    if trimmedValue.hasPrefix("'"), trimmedValue.hasSuffix("'") {
        return .string(try localAISqlParseStringLiteral(trimmedValue))
    }
    if trimmedValue.range(of: #"^-?\d+$"#, options: .regularExpression) != nil {
        guard let value = Int(trimmedValue) else {
            throw LocalStoreError.validation("Unsupported literal: \(trimmedValue)")
        }
        return .integer(value)
    }
    if trimmedValue.range(of: #"^-?\d+\.\d+$"#, options: .regularExpression) != nil {
        guard let value = Double(trimmedValue) else {
            throw LocalStoreError.validation("Unsupported literal: \(trimmedValue)")
        }
        return .number(value)
    }
    throw LocalStoreError.validation("Unsupported literal: \(trimmedValue)")
}

func localAISqlParsePredicateValue(_ value: String) throws -> LocalAISqlPredicateValue {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue.uppercased() == "NOW()" {
        return .now
    }

    return .literal(try localAISqlParseLiteral(trimmedValue))
}

func localAISqlParseStringArrayLiteralList(_ value: String) throws -> [String] {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.hasPrefix("("), trimmedValue.hasSuffix(")") else {
        throw LocalStoreError.validation("Expected a parenthesized value list")
    }
    let innerValue = String(trimmedValue.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
    if innerValue.isEmpty {
        return []
    }

    return try localAISqlSplitTopLevel(value: innerValue, separator: ",").map { item in
        let parsedValue = try localAISqlParseLiteral(item)
        guard case .string(let stringValue) = parsedValue else {
            throw LocalStoreError.validation("Expected only string literals in the list")
        }

        return stringValue
    }
}
