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
fun CloudSignInCodeRoute(
    uiState: CloudSignInUiState,
    onCodeChange: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Verify code",
        onBack = onBack,
        isBackEnabled = uiState.isVerifyingCode.not()
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
                            "Enter the one-time code sent to ${uiState.challengeEmail ?: "your email"} to finish upgrading Guest AI."
                        } else {
                            "Enter the one-time code sent to ${uiState.challengeEmail ?: "your email"}."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    CloudSignInErrorCard(
                        message = uiState.errorMessage,
                        technicalDetails = uiState.errorTechnicalDetails,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.code,
                    onValueChange = onCodeChange,
                    label = {
                        Text("One-time code")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Button(
                    onClick = onVerifyCode,
                    enabled = uiState.isVerifyingCode.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isVerifyingCode) "Verifying..." else "Verify code")
                }
            }
        }
    }
}
