package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material3.Card
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource

@Composable
fun AccountLegalSupportRoute(onBack: () -> Unit) {
    val context = LocalContext.current
    val privacyUrl = stringResource(id = R.string.flashcards_privacy_policy_url)
    val termsUrl = stringResource(id = R.string.flashcards_terms_of_service_url)
    val supportUrl = stringResource(id = R.string.flashcards_support_url)
    val supportEmail = stringResource(id = R.string.flashcards_support_email_address)

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_legal_support_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_legal_support_privacy_title),
                        summary = stringResource(R.string.settings_legal_support_privacy_summary),
                        icon = Icons.Outlined.Description,
                        onClick = {
                            openExternalUrl(context = context, url = privacyUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_legal_support_terms_title),
                        summary = stringResource(R.string.settings_legal_support_terms_summary),
                        icon = Icons.Outlined.Description,
                        onClick = {
                            openExternalUrl(context = context, url = termsUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_legal_support_support_title),
                        summary = stringResource(R.string.settings_legal_support_support_summary),
                        icon = Icons.AutoMirrored.Outlined.OpenInNew,
                        onClick = {
                            openExternalUrl(context = context, url = supportUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_legal_support_contact_title),
                        summary = supportEmail,
                        icon = Icons.Outlined.MailOutline,
                        onClick = {
                            sendSupportEmail(context = context, emailAddress = supportEmail)
                        }
                    )
                }
            }
        }
    }
}
