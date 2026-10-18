package com.flashcardsopensourceapp.app.premium

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsOrange

@Composable
internal fun PremiumOfferHeading() {
    val emphasis = stringResource(R.string.premium_heading_everyone)
    val heading = stringResource(R.string.premium_heading, emphasis)
    val emphasisStart = heading.indexOf(emphasis)
    val text = buildAnnotatedString {
        append(heading)
        if (emphasisStart >= 0) {
            addStyle(SpanStyle(color = FlashcardsOrange), emphasisStart, emphasisStart + emphasis.length)
        }
    }
    Text(
        text = text,
        style = MaterialTheme.typography.headlineLarge,
        modifier = Modifier.testTag("premium_heading")
    )
}

@Composable
internal fun PremiumPlanHeader(title: String, price: String) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (price.isNotEmpty()) {
            Text(
                price,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
internal fun PremiumBenefit(text: String, modifier: Modifier) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
        modifier = Modifier.fillMaxWidth()
    ) {
        Icon(
            imageVector = Icons.Outlined.Check,
            contentDescription = null,
            tint = FlashcardsOrange,
            modifier = Modifier.size(20.dp)
        )
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = modifier.weight(1f))
    }
}

@Composable
internal fun PremiumActionLabel(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(text, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
            contentDescription = null,
            modifier = Modifier.size(20.dp)
        )
    }
}
