package com.flashcardsopensourceapp.core.ui.content

private val fencedCodeMarkerRegex = Regex(pattern = """(?m)^\s*(```|~~~)[^\n]*$""")
private val imageRegex = Regex(pattern = """!\[([^\]]*)]\([^)]*\)""")
private val linkRegex = Regex(pattern = """\[([^\]]*)]\([^)]*\)""")
private val lineMarkerRegex = Regex(pattern = """(?m)^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)""")
private val emphasisRegex = Regex(pattern = """\*\*|__|~~|`|(?<!\w)[*_]|[*_](?!\w)""")
private val whitespaceRegex = Regex(pattern = """\s+""")
private val backslashEscapeRegex = Regex(pattern = """\\([!-/:-@\[-`{-~])""")
private val escapedLiteralPlaceholderRegex = Regex(pattern = """\uE000(\d+)\uE001""")
private val formulaPlaceholderRegex = Regex(pattern = """\uE002(\d+)\uE003""")
private val imageAltOrFormulaPlaceholderRegex = Regex(pattern = """\uE004([^\uE005]*)\uE005|\uE002\d+\uE003""")

/**
 * A card's Markdown flattened to one line for compact previews: markers dropped, backslash escapes
 * resolved, link text kept, images replaced by their alt text, whitespace collapsed. An image without
 * alt text adds nothing; [emptyImageAltText] stands in only when such images are all the side holds,
 * so a row is never blank. An alt that repeats the text right before or after it is dropped, so a
 * prompt followed by its own image reads once. Formulas stay the blocks Review detects, so
 * [MarkdownPreviewText] still renders them.
 */
fun makeMarkdownPreviewBlocks(markdown: String, emptyImageAltText: String): List<MathBlock> {
    // Formulas and escaped characters stand in as private-use placeholders, so the Markdown
    // rewrites below never touch them.
    val formulas: MutableList<MathBlock.Formula> = mutableListOf()
    val escapedLiterals: MutableList<String> = mutableListOf()
    var hasImageWithoutAlt = false
    val markdownWithFormulaPlaceholders: String = extractMathBlocks(
        markdown = removeInlineMathMarkers(text = markdown)
    ).blocks.joinToString(separator = "") { block ->
        when (block) {
            is MathBlock.Markdown -> block.markdown
            is MathBlock.Formula -> {
                formulas.add(block)
                val placeholder = "\uE002${formulas.lastIndex}\uE003"
                if (block.continuesParagraph) placeholder else " $placeholder "
            }
        }
    }
    val plainText: String = markdownWithFormulaPlaceholders
        .replace(backslashEscapeRegex) { match ->
            escapedLiterals.add(match.groupValues[1])
            "\uE000${escapedLiterals.lastIndex}\uE001"
        }
        .replace(fencedCodeMarkerRegex, " ")
        .replace(imageRegex) { match ->
            val altText: String = match.groupValues[1].trim()
            if (altText.isEmpty()) {
                hasImageWithoutAlt = true
                " "
            } else {
                " \uE004$altText\uE005 "
            }
        }
        .replace(linkRegex, "$1")
        .replace(lineMarkerRegex, "")
        .replace(emphasisRegex, "")
        .replace(escapedLiteralPlaceholderRegex) { match -> escapedLiterals[match.groupValues[1].toInt()] }
        .replace(whitespaceRegex, " ")
        .let(::dropImageAltsRepeatingAdjacentText)
        .replace(whitespaceRegex, " ")
        .trim()
        .ifEmpty { if (hasImageWithoutAlt) emptyImageAltText else "" }
    return buildList {
        var textStartIndex = 0
        formulaPlaceholderRegex.findAll(input = plainText).forEach { match ->
            if (textStartIndex < match.range.first) {
                add(makePlainTextBlock(text = plainText.substring(textStartIndex, match.range.first)))
            }
            add(formulas[match.groupValues[1].toInt()])
            textStartIndex = match.range.last + 1
        }
        if (textStartIndex < plainText.length) {
            add(makePlainTextBlock(text = plainText.substring(textStartIndex)))
        }
    }
}

/** [makeMarkdownPreviewBlocks] as one line of plain text, with formulas as their source without delimiters. */
fun makeMarkdownPlainText(markdown: String, emptyImageAltText: String): String {
    return makeMarkdownPreviewBlocks(
        markdown = markdown,
        emptyImageAltText = emptyImageAltText
    ).joinToString(separator = "") { block ->
        when (block) {
            is MathBlock.Markdown -> block.normalizedMarkdown
            is MathBlock.Formula -> block.source
        }
    }.replace(whitespaceRegex, " ").trim()
}

/**
 * Resolves the alt placeholders: the text an alt is compared with runs to the neighbouring alt,
 * formula, or text end.
 */
private fun dropImageAltsRepeatingAdjacentText(text: String): String {
    val placeholders: List<MatchResult> = imageAltOrFormulaPlaceholderRegex.findAll(input = text).toList()
    return buildString {
        var textStartIndex = 0
        placeholders.forEachIndexed { index, match ->
            append(text, textStartIndex, match.range.first)
            textStartIndex = match.range.last + 1
            val altGroup: MatchGroup? = match.groups[1]
            if (altGroup == null) {
                append(match.value)
                return@forEachIndexed
            }
            val altText: String = altGroup.value.trim()
            val textBefore: String = text.substring(
                placeholders.getOrNull(index - 1)?.range?.last?.plus(1) ?: 0,
                match.range.first
            ).trim()
            val textAfter: String = text.substring(
                textStartIndex,
                placeholders.getOrNull(index + 1)?.range?.first ?: text.length
            ).trim()
            if (altText != textBefore && altText != textAfter) {
                append(altText)
            }
        }
        append(text, textStartIndex, text.length)
    }
}

private fun makePlainTextBlock(text: String): MathBlock.Markdown {
    return MathBlock.Markdown(markdown = text, normalizedMarkdown = text)
}
