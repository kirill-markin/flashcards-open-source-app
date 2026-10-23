import Foundation
import MarkdownUI
import SwiftUI
import UIKit

@MainActor
func makeReviewSelectableContent(
    content: ReviewRenderedContent,
    surfaceStyle: ReviewCardSurfaceStyle,
    environment: EnvironmentValues,
    textFont: UIFont? = nil,
    textColor: UIColor = .label
) throws -> NSAttributedString {
    let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: surfaceStyle == .front ? 18 : 17))
    let result = NSMutableAttributedString()

    func appendAttachment(view: AnyView, text: String, layout: ReviewContentAttachmentLayout, attributes: [NSAttributedString.Key: Any], to destination: NSMutableAttributedString) {
        let value = NSMutableAttributedString(attachment: ReviewContentAttachment(
            content: AnyView(view.environment(\.self, environment)),
            copyText: text,
            layout: layout
        ))
        value.addAttributes(attributes, range: NSRange(location: 0, length: value.length))
        destination.append(value)
    }

    func appendMarkdown(_ markdown: MarkdownContent, formulas: [ReviewInlineMathReference]) throws {
        let source = markdown.renderMarkdown()
        let value = try AttributedString(markdown: source, options: .init(interpretedSyntax: .full, appliesSourcePositionAttributes: true))
        let hasNativeBreaks = value.runs.contains { run in
            run.presentationIntent?.components.contains(where: { $0.kind == .thematicBreak }) == true
        }
        // Recover breaks only on Foundation runtimes that omit their nodes; source positions exclude code.
        let occupiedLines = Set(value.runs.flatMap { run -> [Int] in
            guard run.presentationIntent?.components.contains(where: { $0.kind == .thematicBreak }) != true,
                  let position = run.markdownSourcePosition else { return [] }
            return Array(position.startLine...position.endLine)
        })
        var breaks = hasNativeBreaks ? [] : source.components(separatedBy: "\n").enumerated().compactMap { index, line -> Int? in
            let marker = line.replacingOccurrences(of: ">", with: "").filter { $0.isWhitespace == false }
            guard occupiedLines.contains(index + 1) == false, marker.count >= 3,
                  let first = marker.first, "*-_".contains(first), marker.allSatisfy({ $0 == first }) else { return nil }
            return index + 1
        }
        var previousBlock: Int?
        var listItemFirstBlocks: [Int: Int] = [:]
        var table: ReviewSelectableTableContent?
        var previousAttributes: [NSAttributedString.Key: Any] = [:]

        func appendTable() {
            guard let tableContent = table else { return }
            if previousBlock != nil {
                result.append(NSAttributedString(string: "\n", attributes: previousAttributes))
            }
            appendAttachment(
                view: AnyView(ReviewSelectableTable(rows: tableContent.rows)),
                text: tableContent.copyText,
                layout: .block,
                attributes: [:],
                to: result
            )
            result.append(NSAttributedString(string: "\n"))
            table = nil
            previousBlock = nil
            previousAttributes = [:]
        }

        func appendBreak() {
            if result.length > 0 { result.append(NSAttributedString(string: "\n", attributes: previousAttributes)) }
            appendAttachment(view: AnyView(Divider().padding(.vertical, 16)), text: "---", layout: .block, attributes: [:], to: result)
            previousBlock = nil
            previousAttributes = [:]
        }
        var didFailRenderingFormula = false
        for run in value.runs {
            let components = run.presentationIntent?.components ?? []
            let tableIntent = components.first { if case .table = $0.kind { return true }; return false }
            if table?.identity != tableIntent?.identity { appendTable() }
            while let line = breaks.first, let startLine = run.markdownSourcePosition?.startLine, line < startLine {
                appendBreak()
                result.append(NSAttributedString(string: "\n"))
                breaks.removeFirst()
            }
            if components.contains(where: { $0.kind == .thematicBreak }) {
                appendBreak()
                result.append(NSAttributedString(string: "\n"))
                continue
            }
            let block = components.first
            var destination = result
            var tableAlignment: NSTextAlignment?
            var isTableHeader = false
            if let tableIntent, case .table(let columns) = tableIntent.kind,
               let cell = components.first(where: { if case .tableCell = $0.kind { return true }; return false }),
               case .tableCell(let column) = cell.kind {
                let row = components.compactMap { component -> Int? in
                    switch component.kind {
                    case .tableHeaderRow: return 0
                    case .tableRow(let index): return index
                    default: return nil
                    }
                }.first ?? 0
                var currentTable = table ?? ReviewSelectableTableContent(identity: tableIntent.identity, columns: columns)
                destination = currentTable.cell(row: row, column: column)
                table = currentTable
                switch columns[column].alignment {
                case .left: tableAlignment = .left
                case .center: tableAlignment = .center
                case .right: tableAlignment = .right
                @unknown default: tableAlignment = .natural
                }
                isTableHeader = components.contains { $0.kind == .tableHeaderRow }
            }
            var listMarker: String?
            if tableIntent == nil, let block, block.identity != previousBlock {
                if previousBlock != nil {
                    result.append(NSAttributedString(string: "\n", attributes: previousAttributes))
                }
                if let item = components.first(where: { if case .listItem = $0.kind { return true }; return false }),
                   case .listItem(let ordinal) = item.kind, listItemFirstBlocks[item.identity] == nil {
                    let ordered = components.contains { if case .orderedList = $0.kind { return true }; return false }
                    listMarker = ordered ? "\(ordinal). " : "• "
                    listItemFirstBlocks[item.identity] = block.identity
                }
                previousBlock = block.identity
            }

            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = 3
            paragraph.paragraphSpacing = 10
            var pointSize = font.pointSize
            var traits: UIFontDescriptor.SymbolicTraits = []
            var isCode = false
            for component in components {
                switch component.kind {
                case .header(let level):
                    pointSize *= [1.5, 1.3, 1.15, 1, 0.95, 0.9][min(max(level - 1, 0), 5)]
                    traits.insert(.traitBold)
                case .codeBlock:
                    isCode = true
                case .blockQuote:
                    paragraph.headIndent += 16
                    paragraph.firstLineHeadIndent += 16
                case .listItem:
                    paragraph.headIndent += 18
                    if listItemFirstBlocks[component.identity] != block?.identity {
                        paragraph.firstLineHeadIndent += 18
                    }
                    paragraph.paragraphSpacing = 4
                default:
                    break
                }
            }
            if let tableAlignment {
                paragraph.alignment = tableAlignment
                paragraph.paragraphSpacing = 0
            }
            if isTableHeader { traits.insert(.traitBold) }
            let inline = run.inlinePresentationIntent ?? []
            if inline.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
            if inline.contains(.emphasized) { traits.insert(.traitItalic) }
            isCode = isCode || inline.contains(.code)
            let baseFont = isCode ? UIFont.monospacedSystemFont(ofSize: pointSize * 0.88, weight: .regular) : UIFont.systemFont(ofSize: pointSize)
            let styledFont = baseFont.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: baseFont.pointSize) } ?? baseFont
            var attributes: [NSAttributedString.Key: Any] = [.font: styledFont, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
            if isCode { attributes[.backgroundColor] = UIColor.secondarySystemBackground }
            if inline.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let link = run.link { attributes[.link] = link }
            if let listMarker {
                destination.append(NSAttributedString(string: listMarker, attributes: attributes))
            }
            previousAttributes = attributes
            let text = String(value[run.range].characters)
            if let url = run.imageURL {
                if let formula = formulas.first(where: { $0.source == url.absoluteString }) {
                    let rendering = makeReviewInlineMathRendering(
                        references: [formula], fontSize: font.pointSize,
                        color: reviewMathRenderableColor(UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: environment.colorScheme == .dark ? .dark : .light))),
                        displayScale: environment.displayScale
                    )
                    didFailRenderingFormula = didFailRenderingFormula || rendering.didFailRendering
                    if let image = rendering.images[formula.source] {
                        appendAttachment(view: AnyView(image.accessibilityLabel(formula.formula.latex)), text: formula.formula.originalSource, layout: .inline, attributes: attributes, to: destination)
                    }
                } else {
                    #if targetEnvironment(macCatalyst)
                    appendAttachment(view: AnyView(MacReviewImageView(state: MacReviewImageState(url: url))), text: text, layout: .block, attributes: attributes, to: destination)
                    #else
                    appendAttachment(view: AnyView(DefaultImageProvider.default.makeImage(url: url)), text: text, layout: .block, attributes: attributes, to: destination)
                    #endif
                }
                continue
            }

            destination.append(NSAttributedString(string: text, attributes: attributes))
        }
        appendTable()
        for _ in breaks { appendBreak() }
        if didFailRenderingFormula {
            result.append(NSAttributedString(
                string: "\n" + String(localized: "Formula couldn't be rendered. Check the LaTeX syntax.", table: "ReviewCards"),
                attributes: [.font: UIFont.preferredFont(forTextStyle: .caption1), .foregroundColor: UIColor.systemRed]
            ))
        }
    }

    switch content {
    case .mathText(let blocks):
        let textFont = textFont ?? font
        let attributes: [NSAttributedString.Key: Any] = [.font: textFont, .foregroundColor: textColor]
        var didFailRenderingFormula = false
        for block in blocks {
            switch block {
            case .markdown(let source):
                result.append(NSAttributedString(string: source, attributes: attributes))
            case .formula(let formula):
                if formula.continuesParagraph {
                    let reference = ReviewInlineMathReference(source: "formula", formula: formula)
                    let rendering = makeReviewInlineMathRendering(
                        references: [reference], fontSize: textFont.pointSize,
                        color: reviewMathRenderableColor(textColor.resolvedColor(with: UITraitCollection(userInterfaceStyle: environment.colorScheme == .dark ? .dark : .light))),
                        displayScale: environment.displayScale
                    )
                    didFailRenderingFormula = didFailRenderingFormula || rendering.didFailRendering
                    if let image = rendering.images[reference.source] {
                        appendAttachment(view: AnyView(image.accessibilityLabel(formula.latex)), text: formula.originalSource, layout: .inline, attributes: attributes, to: result)
                    }
                } else {
                    appendAttachment(
                        view: AnyView(ReviewMathFormulaView(formula: formula, surfaceStyle: surfaceStyle, textFontSize: textFont.pointSize, textColor: Color(uiColor: reviewMathRenderableColor(textColor.resolvedColor(with: UITraitCollection(userInterfaceStyle: environment.colorScheme == .dark ? .dark : .light)))))),
                        text: formula.originalSource, layout: .block, attributes: attributes, to: result
                    )
                }
            }
        }
        if didFailRenderingFormula {
            result.append(NSAttributedString(
                string: "\n" + String(localized: "Formula couldn't be rendered. Check the LaTeX syntax.", table: "ReviewCards"),
                attributes: [.font: UIFont.preferredFont(forTextStyle: .caption1), .foregroundColor: UIColor.systemRed]
            ))
        }
    case .shortPlain(let text):
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let style: UIFont.TextStyle = surfaceStyle == .front ? .title2 : .title3
        let base = UIFont.preferredFont(forTextStyle: style)
        let titleFont = UIFont.systemFont(ofSize: base.pointSize, weight: surfaceStyle == .front ? .semibold : .medium)
        result.append(NSAttributedString(string: text, attributes: [.font: titleFont, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]))
    case .paragraphPlain(let text):
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 3
        result.append(NSAttributedString(string: text, attributes: [.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label, .paragraphStyle: paragraph]))
    case .markdown(let markdown):
        try appendMarkdown(markdown, formulas: [])
    case .managedMarkdown(let managed):
        for (index, block) in managed.blocks.enumerated() {
            if index > 0 { result.append(NSAttributedString(string: "\n")) }
            switch block {
            case .markdown(let markdown, let formulas):
                try appendMarkdown(markdown, formulas: formulas)
            case .formula(let formula):
                #if targetEnvironment(macCatalyst)
                appendAttachment(view: AnyView(ReviewMathFormulaView(formula: formula, surfaceStyle: surfaceStyle, rendering: MacReviewFormulaState())), text: formula.originalSource, layout: .block, attributes: [:], to: result)
                #else
                appendAttachment(view: AnyView(ReviewMathFormulaView(formula: formula, surfaceStyle: surfaceStyle)), text: formula.originalSource, layout: .block, attributes: [:], to: result)
                #endif
            case .managedMedia(let reference):
                #if targetEnvironment(macCatalyst)
                appendAttachment(view: AnyView(ReviewManagedMediaView(reference: reference, surfaceStyle: surfaceStyle, retainedState: MacReviewManagedMediaState())), text: reference.label ?? "fcasset:\(reference.mediaAssetId)", layout: .block, attributes: [:], to: result)
                #else
                appendAttachment(view: AnyView(ReviewManagedMediaView(reference: reference, surfaceStyle: surfaceStyle)), text: reference.label ?? "fcasset:\(reference.mediaAssetId)", layout: .block, attributes: [:], to: result)
                #endif
            }
        }
    }
    return result
}
