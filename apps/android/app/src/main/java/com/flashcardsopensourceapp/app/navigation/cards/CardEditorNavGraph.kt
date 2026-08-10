package com.flashcardsopensourceapp.app.navigation.cards

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.enqueueMediaUploadWorker
import com.flashcardsopensourceapp.app.navigation.AiDestination
import com.flashcardsopensourceapp.app.navigation.navigateToTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.rememberRouteBackStackEntry
import com.flashcardsopensourceapp.feature.cards.R as CardsR
import com.flashcardsopensourceapp.feature.cards.cardEditorBackTextFieldTag
import com.flashcardsopensourceapp.feature.cards.cardEditorFrontTextFieldTag
import com.flashcardsopensourceapp.feature.cards.createCardEditorViewModelFactory
import com.flashcardsopensourceapp.feature.cards.editor.CardEditorLoadingOrUnavailableRoute
import com.flashcardsopensourceapp.feature.cards.editor.CardEditorRoute
import com.flashcardsopensourceapp.feature.cards.editor.CardEditorTextField
import com.flashcardsopensourceapp.feature.cards.editor.CardEditorViewModel
import com.flashcardsopensourceapp.feature.cards.editor.CardTagsRoute
import com.flashcardsopensourceapp.feature.cards.editor.CardTextEditorRoute
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val newCardRouteArgument: String = "new"

internal fun NavGraphBuilder.registerCardEditorNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    navigation(
        startDestination = CardEditorDestination.routePattern,
        route = CardEditorGraph.routePattern,
        arguments = listOf(navArgument(name = CardEditorGraph.routeArgument) {
            type = NavType.StringType
        })
    ) {
        composable(
            route = CardEditorDestination.routePattern,
            arguments = listOf(navArgument(name = CardEditorDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val editingArgument = requireNotNull(backStackEntry.arguments?.getString(CardEditorDestination.routeArgument)) {
                "Card editor route requires cardId."
            }
            val editingCardId = resolveEditingCardId(editingArgument = editingArgument)
            val editorBackStackEntry = rememberRouteBackStackEntry(
                navController = navController,
                currentBackStackEntry = backStackEntry,
                route = CardEditorGraph.createRoute(cardId = editingArgument)
            )
            val editorViewModel = viewModel<CardEditorViewModel>(
                viewModelStoreOwner = editorBackStackEntry,
                factory = createCardEditorViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingCardId = editingCardId
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()

            CardEditorRoute(
                uiState = uiState,
                onOpenFrontTextEditor = {
                    navController.navigate(
                        route = CardEditorTextDestination.createRoute(
                            cardId = editingArgument,
                            field = "front"
                        )
                    )
                },
                onOpenBackTextEditor = {
                    navController.navigate(
                        route = CardEditorTextDestination.createRoute(
                            cardId = editingArgument,
                            field = "back"
                        )
                    )
                },
                onOpenTagsEditor = {
                    navController.navigate(route = CardEditorTagsDestination.createRoute(cardId = editingArgument))
                },
                onEditWithAi = if (editingCardId == null) {
                    null
                } else {
                    {
                        val handoffCardId = requireNotNull(editingCardId)
                        coroutineScope.launch {
                            val savedCardDraft = editorViewModel.save(editingCardId = handoffCardId)
                            if (savedCardDraft == null) {
                                return@launch
                            }

                            appGraph.appHandoffCoordinator.requestAiCardHandoff(
                                cardId = handoffCardId,
                                frontText = savedCardDraft.frontText,
                                backText = savedCardDraft.backText,
                                tags = savedCardDraft.tags
                            )
                            navigateToTopLevelDestination(
                                navController = navController,
                                destination = AiDestination
                            )
                        }
                    }
                },
                onRemoveTag = editorViewModel::removeTag,
                onSave = {
                    coroutineScope.launch {
                        val didSave = editorViewModel.save(editingCardId = editingCardId)
                        if (didSave != null) {
                            withContext(Dispatchers.Main.immediate) {
                                navController.popBackStack()
                            }
                        }
                    }
                },
                onDelete = if (editingCardId == null) {
                    null
                } else {
                    {
                        coroutineScope.launch {
                            val didDelete = editorViewModel.delete(editingCardId = editingCardId)
                            if (didDelete) {
                                withContext(Dispatchers.Main.immediate) {
                                    navController.popBackStack()
                                }
                            }
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = CardEditorTextDestination.routePattern,
            arguments = listOf(
                navArgument(name = CardEditorTextDestination.cardIdArgument) {
                    type = NavType.StringType
                },
                navArgument(name = CardEditorTextDestination.fieldArgument) {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val editingArgument = requireNotNull(
                backStackEntry.arguments?.getString(CardEditorTextDestination.cardIdArgument)
            ) {
                "Card text editor route requires cardId."
            }
            val field = requireNotNull(
                backStackEntry.arguments?.getString(CardEditorTextDestination.fieldArgument)
            ) {
                "Card text editor route requires field."
            }
            val editorBackStackEntry = rememberRouteBackStackEntry(
                navController = navController,
                currentBackStackEntry = backStackEntry,
                route = CardEditorGraph.createRoute(cardId = editingArgument)
            )
            val editorViewModel = viewModel<CardEditorViewModel>(
                viewModelStoreOwner = editorBackStackEntry,
                factory = createCardEditorViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingCardId = resolveEditingCardId(editingArgument = editingArgument)
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()
            if (uiState.isLoading || uiState.isCardUnavailable) {
                CardEditorLoadingOrUnavailableRoute(
                    uiState = uiState,
                    onBack = {
                        navController.popBackStack()
                    }
                )
                return@composable
            }

            val editorTextField = resolveEditorTextField(field = field)
            val context = LocalContext.current
            val managedImageAltText = stringResource(id = CardsR.string.cards_editor_image_label)
            var isAddingImage by remember {
                mutableStateOf(value = false)
            }
            val imagePickerLauncher = rememberLauncherForActivityResult(
                contract = ActivityResultContracts.PickVisualMedia()
            ) { uri ->
                if (uri == null) {
                    return@rememberLauncherForActivityResult
                }

                isAddingImage = true
                coroutineScope.launch {
                    try {
                        val authoringResult = appGraph.managedMediaAuthoringRepository.authorManagedImageFromUri(
                            uri = uri,
                            altText = managedImageAltText
                        )
                        editorViewModel.insertManagedImageMarkdown(
                            field = editorTextField,
                            markdown = authoringResult.markdown
                        )
                        enqueueMediaUploadWorker(
                            context = context.applicationContext,
                            initialDelayMillis = 0L
                        )
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        appGraph.appMessageBus.showMessage(
                            message = cardEditorImageInsertFailureMessage(
                                context = context,
                                error = error
                            )
                        )
                    } finally {
                        isAddingImage = false
                    }
                }
            }

            CardTextEditorRoute(
                title = if (editorTextField == CardEditorTextField.FRONT) {
                    stringResource(id = CardsR.string.cards_front_title)
                } else {
                    stringResource(id = CardsR.string.cards_back_title)
                },
                supportingText = if (editorTextField == CardEditorTextField.FRONT) {
                    stringResource(id = CardsR.string.cards_front_supporting_text)
                } else {
                    stringResource(id = CardsR.string.cards_back_supporting_text)
                },
                text = if (editorTextField == CardEditorTextField.FRONT) uiState.frontText else uiState.backText,
                selection = if (editorTextField == CardEditorTextField.FRONT) {
                    uiState.frontTextSelection
                } else {
                    uiState.backTextSelection
                },
                managedImageReferences = if (editorTextField == CardEditorTextField.FRONT) {
                    uiState.frontManagedImageReferences
                } else {
                    uiState.backManagedImageReferences
                },
                textFieldTag = if (editorTextField == CardEditorTextField.FRONT) {
                    cardEditorFrontTextFieldTag
                } else {
                    cardEditorBackTextFieldTag
                },
                isAddingMedia = isAddingImage,
                onTextChange = if (editorTextField == CardEditorTextField.FRONT) {
                    editorViewModel::updateFrontText
                } else {
                    editorViewModel::updateBackText
                },
                onSelectionChange = if (editorTextField == CardEditorTextField.FRONT) {
                    editorViewModel::updateFrontTextSelection
                } else {
                    editorViewModel::updateBackTextSelection
                },
                onInsertImage = {
                    imagePickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onRemoveManagedImageReference = { referenceKey ->
                    editorViewModel.removeManagedImageReference(
                        field = editorTextField,
                        referenceKey = referenceKey
                    )
                },
                onLoadManagedImageUri = { mediaAssetId ->
                    appGraph.reviewRepository.loadReviewMediaAssetFile(mediaAssetId = mediaAssetId).uri
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = CardEditorTagsDestination.routePattern,
            arguments = listOf(navArgument(name = CardEditorTagsDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val editingArgument = requireNotNull(
                backStackEntry.arguments?.getString(CardEditorTagsDestination.routeArgument)
            ) {
                "Card tags route requires cardId."
            }
            val editorBackStackEntry = rememberRouteBackStackEntry(
                navController = navController,
                currentBackStackEntry = backStackEntry,
                route = CardEditorGraph.createRoute(cardId = editingArgument)
            )
            val editorViewModel = viewModel<CardEditorViewModel>(
                viewModelStoreOwner = editorBackStackEntry,
                factory = createCardEditorViewModelFactory(
                    cardsRepository = appGraph.cardsRepository,
                    workspaceRepository = appGraph.workspaceRepository,
                    editingCardId = resolveEditingCardId(editingArgument = editingArgument)
                )
            )
            val uiState by editorViewModel.uiState.collectAsStateWithLifecycle()
            if (uiState.isLoading || uiState.isCardUnavailable) {
                CardEditorLoadingOrUnavailableRoute(
                    uiState = uiState,
                    onBack = {
                        navController.popBackStack()
                    }
                )
                return@composable
            }

            CardTagsRoute(
                uiState = uiState,
                onToggleSuggestedTag = editorViewModel::toggleTag,
                onAddTag = editorViewModel::addTag,
                onRemoveTag = editorViewModel::removeTag,
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}

private fun resolveEditingCardId(editingArgument: String): String? {
    return if (editingArgument == newCardRouteArgument) {
        null
    } else {
        editingArgument
    }
}

private fun resolveEditorTextField(field: String): CardEditorTextField {
    return when (field) {
        "front" -> CardEditorTextField.FRONT
        "back" -> CardEditorTextField.BACK
        else -> throw IllegalArgumentException(
            "Card text editor field must be 'front' or 'back', found '$field'."
        )
    }
}

private fun cardEditorImageInsertFailureMessage(
    context: Context,
    error: Exception
): String {
    val errorMessage = error.message?.trim()
    val reason = if (errorMessage.isNullOrBlank()) {
        context.getString(CardsR.string.cards_editor_add_image_unknown_error)
    } else {
        errorMessage
    }
    return context.getString(
        CardsR.string.cards_editor_add_image_failed,
        reason
    )
}
