package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import com.flashcardsopensourceapp.feature.settings.openExternalUrl

@Composable
internal fun ConsentGate(
    currentWorkspaceName: String,
    onAcceptConsent: () -> Unit,
    modifier: Modifier
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    val privacyUrl = stringResource(id = SettingsR.string.flashcards_privacy_policy_url)
    val termsUrl = stringResource(id = SettingsR.string.flashcards_terms_of_service_url)
    val supportUrl = stringResource(id = SettingsR.string.flashcards_support_url)
    val workspaceDisclosureTemplate = stringResource(id = R.string.ai_consent_workspace_disclosure)

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.fillMaxSize()
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(24.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Lock,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = stringResource(id = R.string.ai_consent_title),
                    style = MaterialTheme.typography.headlineSmall
                )
                Text(
                    text = stringResource(id = R.string.ai_consent_warning),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = formatAiConsentWorkspaceDisclosureText(
                        template = workspaceDisclosureTemplate,
                        currentWorkspaceName = currentWorkspaceName,
                        locale = locale
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Button(
                    onClick = onAcceptConsent,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(id = R.string.ai_consent_accept))
                }

                HorizontalDivider()

                TextButton(
                    onClick = {
                        openExternalUrl(context = context, url = privacyUrl)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(id = R.string.ai_privacy_policy))
                }

                TextButton(
                    onClick = {
                        openExternalUrl(context = context, url = termsUrl)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(id = R.string.ai_terms_of_service))
                }

                TextButton(
                    onClick = {
                        openExternalUrl(context = context, url = supportUrl)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(id = R.string.ai_support))
                }
            }
        }
    }
}
