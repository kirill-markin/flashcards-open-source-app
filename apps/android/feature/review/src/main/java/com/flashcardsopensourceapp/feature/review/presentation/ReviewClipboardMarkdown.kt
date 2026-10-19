package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.media.parseManagedMediaReference
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.parser.CancellationToken
import org.intellij.markdown.parser.LinkMap
import org.intellij.markdown.parser.MarkdownParser

internal fun reviewSideMarkdownForClipboard(
    sourceText: String,
    privateMediaPlaceholder: (String) -> String
): String {
    // Mask accepted math without changing source offsets or normalizing escaped dollars.
    val mediaMarkdown: CharSequence = buildString(capacity = sourceText.length) {
        extractReviewMathBlocks(markdown = sourceText).blocks.forEach { block ->
            when (block) {
                is ReviewMathBlock.Markdown -> append(block.markdown)
                is ReviewMathBlock.Formula -> block.delimitedSource.forEach { character ->
                    append(if (character == '\r' || character == '\n') character else ' ')
                }
            }
        }
    }
    val tree: ASTNode = MarkdownParser(
        flavour = GFMFlavourDescriptor(),
        assertionsEnabled = true,
        cancellationToken = CancellationToken.NonCancellable
    ).buildMarkdownTreeFromString(mediaMarkdown)
    val linkMap: LinkMap = LinkMap.buildLinkMap(tree, mediaMarkdown)
    val replacements: List<Pair<IntRange, String>> = reviewClipboardReplacements(
        node = tree,
        sourceText = sourceText,
        linkMap = linkMap,
        privateMediaPlaceholder = privateMediaPlaceholder
    )
    // Edit source ranges only; Markdown serialization would change code, math and whitespace.
    return replacements.asReversed().fold(sourceText) { markdown, (range, placeholder) ->
        markdown.replaceRange(range = range, replacement = placeholder)
    }
}

private fun reviewClipboardReplacements(
    node: ASTNode,
    sourceText: String,
    linkMap: LinkMap,
    privateMediaPlaceholder: (String) -> String
): List<Pair<IntRange, String>> {
    if (node.type == MarkdownElementTypes.CODE_FENCE ||
        node.type == MarkdownElementTypes.CODE_BLOCK ||
        node.type == MarkdownElementTypes.CODE_SPAN ||
        node.type == GFMElementTypes.INLINE_MATH ||
        node.type == GFMElementTypes.BLOCK_MATH
    ) {
        return emptyList()
    }

    val link: ASTNode = if (node.type == MarkdownElementTypes.IMAGE) {
        node.children.firstOrNull { child ->
            child.type == MarkdownElementTypes.INLINE_LINK ||
                child.type == MarkdownElementTypes.FULL_REFERENCE_LINK ||
                child.type == MarkdownElementTypes.SHORT_REFERENCE_LINK
        } ?: node
    } else {
        node
    }
    val destination: ASTNode? = link.children.firstOrNull { child ->
        child.type == MarkdownElementTypes.LINK_DESTINATION
    }
    val label: ASTNode? = link.children.firstOrNull { child ->
        child.type == MarkdownElementTypes.LINK_TEXT
    } ?: link.children.firstOrNull { child ->
        child.type == MarkdownElementTypes.LINK_LABEL
    }
    val referenceLabel: ASTNode? = link.children.lastOrNull { child ->
        child.type == MarkdownElementTypes.LINK_LABEL
    }
    val rawDestination: String? = when {
        destination != null -> sourceText.substring(destination.startOffset, destination.endOffset)
            .removeSurrounding(prefix = "<", suffix = ">")
        (link.type == MarkdownElementTypes.FULL_REFERENCE_LINK ||
            link.type == MarkdownElementTypes.SHORT_REFERENCE_LINK) && referenceLabel != null -> {
            linkMap.getLinkInfo(
                sourceText.subSequence(referenceLabel.startOffset, referenceLabel.endOffset)
            )?.destination?.toString()
        }
        else -> null
    }
    if (rawDestination != null && parseManagedMediaReference(reference = rawDestination) != null) {
        val mediaLabel: String = label?.let { labelNode ->
            sourceText.substring(labelNode.startOffset + 1, labelNode.endOffset - 1).trim()
        }.orEmpty()
        return listOf(
            (node.startOffset until node.endOffset) to privateMediaPlaceholder(mediaLabel)
        )
    }

    return node.children.flatMap { child ->
        reviewClipboardReplacements(
            node = child,
            sourceText = sourceText,
            linkMap = linkMap,
            privateMediaPlaceholder = privateMediaPlaceholder
        )
    }
}
