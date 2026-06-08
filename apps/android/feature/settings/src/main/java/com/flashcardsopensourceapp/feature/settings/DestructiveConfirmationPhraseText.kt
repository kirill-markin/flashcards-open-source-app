package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow

private const val confirmationPhraseLongTokenBreakThreshold: Int = 24
private const val confirmationPhraseBreakOpportunity: String = "\u200B"

@Composable
fun DestructiveConfirmationPhraseText(text: String, testTag: String, modifier: Modifier) {
    val originalText: AnnotatedString = AnnotatedString(text)

    Text(
        text = confirmationPhraseDisplayText(text = text),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
        softWrap = true,
        maxLines = Int.MAX_VALUE,
        overflow = TextOverflow.Visible,
        modifier = modifier
            .fillMaxWidth()
            .clearAndSetSemantics {
                this.text = originalText
                this.testTag = testTag
            }
    )
}

private fun confirmationPhraseDisplayText(text: String): String {
    val result: StringBuilder = StringBuilder()
    val token: StringBuilder = StringBuilder()

    text.forEach { character: Char ->
        if (confirmationPhraseIsWhitespace(character = character)) {
            result.append(confirmationPhraseDisplayToken(token = token.toString()))
            token.clear()
            result.append(character)
        } else {
            token.append(character)
        }
    }

    result.append(confirmationPhraseDisplayToken(token = token.toString()))
    return result.toString()
}

private fun confirmationPhraseDisplayToken(token: String): String {
    if (token.length <= confirmationPhraseLongTokenBreakThreshold) {
        return token
    }
    if (confirmationPhraseIsAsciiToken(token = token) == false) {
        return token
    }

    return token
        .map { character: Char -> character.toString() }
        .joinToString(separator = confirmationPhraseBreakOpportunity)
}

private fun confirmationPhraseIsAsciiToken(token: String): Boolean {
    return token.all { character: Char -> character.code <= 0x7F }
}

private fun confirmationPhraseIsWhitespace(character: Char): Boolean {
    return character.isWhitespace()
}
