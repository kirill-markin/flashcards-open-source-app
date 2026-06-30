package com.flashcardsopensourceapp.feature.review

fun makeReviewSpeakableText(text: String): String {
    if (text.trim().isEmpty()) {
        return ""
    }

    if (classifyReviewContentPresentation(text = text) != ReviewContentPresentationMode.RICH) {
        return normalizeReviewSpeakableText(lines = text.split(Regex(pattern = """\R+""")))
    }

    val speakableLines: List<String> = buildList {
        var activeFenceMarker: String? = null

        text.lines().forEach { line ->
            val fenceMarker: String? = reviewFenceMarker(line = line)

            if (activeFenceMarker != null) {
                if (fenceMarker == activeFenceMarker) {
                    activeFenceMarker = null
                }
                return@forEach
            }

            if (fenceMarker != null) {
                activeFenceMarker = fenceMarker
                return@forEach
            }

            val normalizedLine: String = normalizeReviewSpeakableMarkdownLine(line = line)
            if (normalizedLine.isNotEmpty()) {
                add(normalizedLine)
            }
        }
    }

    return normalizeReviewSpeakableText(lines = speakableLines)
}

private fun reviewFenceMarker(line: String): String? {
    val match: MatchResult? = reviewFenceRegex.matchEntire(line.trim())
    return match?.groups?.get(index = 1)?.value
}

private fun normalizeReviewSpeakableMarkdownLine(line: String): String {
    val trimmedLine: String = line.trim()
    if (trimmedLine.isEmpty()) {
        return ""
    }
    if (reviewHorizontalRuleRegex.matches(trimmedLine) || reviewTableDelimiterRegex.matches(trimmedLine)) {
        return ""
    }

    reviewHeadingRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[2])
    }
    reviewQuoteRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }
    reviewBulletRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }
    reviewOrderedListRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }

    return normalizeReviewSpeakableInlineText(text = trimmedLine)
}

private fun normalizeReviewSpeakableText(lines: List<String>): String {
    return lines.map { line ->
        normalizeReviewSpeakableInlineText(text = line)
    }.filter { line ->
        line.isNotEmpty()
    }.joinToString(separator = "\n")
}

private fun normalizeReviewSpeakableInlineText(text: String): String {
    return reviewSpeakableTextReplacingManagedMediaReferences(text = text)
        .replace(oldValue = "`", newValue = "")
        .replace(oldValue = "|", newValue = " ")
        .replace(regex = Regex(pattern = """\s+"""), replacement = " ")
        .trim()
}

private fun reviewSpeakableTextReplacingManagedMediaReferences(text: String): String {
    var output: String = text
    reviewManagedMediaReferenceRegex.findAll(input = text).toList().asReversed().forEach { match ->
        val reference: String = match.groups[3]?.value ?: return@forEach
        if (parseReviewManagedMediaAssetId(reference = reference) == null) {
            return@forEach
        }

        val label: String = match.groups[2]?.value?.trim().orEmpty()
        output = output.replaceRange(
            range = match.range,
            replacement = label
        )
    }

    return output
}
