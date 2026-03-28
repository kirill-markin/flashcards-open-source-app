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
        title = "Legal & Support",
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
                        title = "Privacy policy",
                        summary = "Open hosted privacy details",
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
                        title = "Terms of service",
                        summary = "Open hosted terms",
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
                        title = "Support",
                        summary = "Open hosted support page",
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
                        title = "Support email",
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
