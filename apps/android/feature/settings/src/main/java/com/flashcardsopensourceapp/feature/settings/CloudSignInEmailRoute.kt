package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun CloudSignInEmailRoute(
    uiState: CloudSignInUiState,
    onEmailChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Sign in",
        onBack = onBack,
        isBackEnabled = uiState.isSendingCode.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (uiState.isGuestUpgrade) {
                            "Sign in with email to upgrade this Guest AI session into a linked cloud account."
                        } else {
                            "Sign in with email to link this Android device to your cloud workspace."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.email,
                    onValueChange = onEmailChange,
                    label = {
                        Text("Email")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Button(
                    onClick = onSendCode,
                    enabled = uiState.isSendingCode.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isSendingCode) "Sending..." else "Send one-time code")
                }
            }
        }
    }
}
