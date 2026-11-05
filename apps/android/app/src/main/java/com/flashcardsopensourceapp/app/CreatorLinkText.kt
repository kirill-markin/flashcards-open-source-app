package com.flashcardsopensourceapp.app

import androidx.annotation.StringRes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsAppearance
import com.flashcardsopensourceapp.core.ui.theme.LocalFlashcardsAppearance

/**
 * Renders a string whose `%1$s` is the creator's name, with the name linking to the creator's site.
 */
@Composable
internal fun CreatorLinkText(@StringRes textWithCreatorName: Int) {
    val name = stringResource(R.string.premium_creator_name)
    val support = stringResource(textWithCreatorName, name)
    val nameStart = support.indexOf(name)
    val linkColor = when (LocalFlashcardsAppearance.current) {
        FlashcardsAppearance.DARK -> Color.White
        FlashcardsAppearance.LIGHT -> MaterialTheme.colorScheme.onSurface
    }
    val text = buildAnnotatedString {
        if (nameStart < 0) {
            append(support)
        } else {
            append(support.substring(0, nameStart))
            withLink(LinkAnnotation.Url(
                url = "https://kirill-markin.com/",
                styles = TextLinkStyles(style = SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
            )) { append(name) }
            append(support.substring(nameStart + name.length))
        }
    }
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}
