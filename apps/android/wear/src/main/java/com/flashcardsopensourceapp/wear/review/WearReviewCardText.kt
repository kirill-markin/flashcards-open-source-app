package com.flashcardsopensourceapp.wear.review

import com.flashcardsopensourceapp.core.ui.content.MathBlock
import com.flashcardsopensourceapp.core.ui.content.extractMathBlocks
import com.flashcardsopensourceapp.core.ui.content.isMarkdownFenceClosingLine
import com.flashcardsopensourceapp.core.ui.content.markdownFenceMarker
import com.flashcardsopensourceapp.data.local.model.media.parseManagedMediaReference

/** A card side as the watch shows it: plain text, plus whether an image or formula was left out. */
data class WearReviewCardSideText(
    val text: String,
    val hasOmittedContent: Boolean
)

private data class WearPlainText(
    val text: String,
    val hasOmittedImage: Boolean
)

private val headingPrefixRegex = Regex(pattern = """^\s{0,3}#{1,6}\s+""")
private val blockquotePrefixRegex = Regex(pattern = """^\s{0,3}>\s?""")
private val inlineCodeRegex = Regex(pattern = """(`+)(.+?)\1""")
private val imageRegex = Regex(pattern = """!\[[^\]]*]\([^)]*\)""")
private val linkRegex = Regex(pattern = """\[([^\]]*)]\(\s*([^)\s]*)[^)]*\)""")
private val emphasisRegex = Regex(pattern = """\*\*|__|~~|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)""")
private val backslashEscapeRegex = Regex(pattern = """\\([!-/:-@\[-`{-~])""")
private val escapedLiteralPlaceholderRegex = Regex(pattern = """\uE000(\d+)\uE001""")
private val inlineCodePlaceholderRegex = Regex(pattern = """\uE002(\d+)\uE003""")

/**
 * The watch renders no images or formulas; it leaves them out and tells the person to open the card
 * on the phone. Formulas are the ones the phone renders, so code, escaped `\$` and prices stay text.
 */
fun makeWearReviewCardSideText(markdown: String): WearReviewCardSideText {
    val blocks: List<MathBlock> = extractMathBlocks(markdown = markdown).blocks
    val formulaFreeMarkdown: String = blocks.joinToString(separator = "") { block ->
        when (block) {
            is MathBlock.Markdown -> block.markdown
            is MathBlock.Formula -> ""
        }
    }
    val plainText: WearPlainText = makeWearPlainText(markdown = formulaFreeMarkdown)
    return WearReviewCardSideText(
        text = plainText.text.trim(),
        hasOmittedContent = blocks.any { block -> block is MathBlock.Formula } || plainText.hasOmittedImage
    )
}

/** Code fences keep their lines verbatim; other lines lose heading and quote markers and inline formatting. */
private fun makeWearPlainText(markdown: String): WearPlainText {
    var openFenceMarker: String? = null
    var hasOmittedImage = false
    val lines: MutableList<String> = mutableListOf()
    for (rawLine in markdown.split("\n")) {
        val line: String = rawLine.removeSuffix("\r")
        val fenceMarker: String? = openFenceMarker
        if (fenceMarker != null) {
            if (isMarkdownFenceClosingLine(line = line, openingMarker = fenceMarker)) {
                openFenceMarker = null
            } else {
                lines.add(line)
            }
            continue
        }
        val openingMarker: String? = markdownFenceMarker(line = line)
        if (openingMarker != null) {
            openFenceMarker = openingMarker
            continue
        }

        val blockText: String = line.replace(headingPrefixRegex, "").replace(blockquotePrefixRegex, "")
        val inlineText: WearPlainText = makeWearInlinePlainText(markdown = blockText)
        hasOmittedImage = hasOmittedImage || inlineText.hasOmittedImage
        lines.add(inlineText.text)
    }
    return WearPlainText(text = lines.joinToString(separator = "\n"), hasOmittedImage = hasOmittedImage)
}

/**
 * Images and `fcasset:` media links are left out; link text stays, inline code stays as typed, and
 * backslash escapes show the escaped character. Code and escapes stand in as private-use
 * placeholders, so the rewrites below never touch them.
 */
private fun makeWearInlinePlainText(markdown: String): WearPlainText {
    val codeSpans: MutableList<String> = mutableListOf()
    val escapedLiterals: MutableList<String> = mutableListOf()
    var hasOmittedImage = false
    val text: String = markdown
        .replace(inlineCodeRegex) { match ->
            codeSpans.add(match.groupValues[2])
            "\uE002${codeSpans.lastIndex}\uE003"
        }
        .replace(backslashEscapeRegex) { match ->
            escapedLiterals.add(match.groupValues[1])
            "\uE000${escapedLiterals.lastIndex}\uE001"
        }
        .replace(imageRegex) {
            hasOmittedImage = true
            ""
        }
        .replace(linkRegex) { match ->
            if (parseManagedMediaReference(reference = match.groupValues[2]) != null) {
                hasOmittedImage = true
                ""
            } else {
                match.groupValues[1]
            }
        }
        .replace(emphasisRegex, "")
        .replace(escapedLiteralPlaceholderRegex) { match -> escapedLiterals[match.groupValues[1].toInt()] }
        .replace(inlineCodePlaceholderRegex) { match -> codeSpans[match.groupValues[1].toInt()] }
    return WearPlainText(text = text, hasOmittedImage = hasOmittedImage)
}
