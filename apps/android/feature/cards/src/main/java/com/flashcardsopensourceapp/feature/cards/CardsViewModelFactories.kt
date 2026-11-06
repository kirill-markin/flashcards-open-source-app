package com.flashcardsopensourceapp.feature.cards

import android.app.Application
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogBrowseIndexRepository
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogDeckInstallRepository
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogDeckPageRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogDeckViewModel
import com.flashcardsopensourceapp.feature.cards.catalog.CatalogViewModel
import com.flashcardsopensourceapp.feature.cards.catalog.createCatalogStringResolver
import com.flashcardsopensourceapp.feature.cards.editor.CardEditorViewModel
import com.flashcardsopensourceapp.feature.cards.library.LibraryViewModel
import com.flashcardsopensourceapp.feature.cards.list.CardsViewModel

fun createCardsViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            val application = requireApplication()
            CardsViewModel(
                cardsRepository = cardsRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                visibleAppScreenRepository = visibleAppScreenRepository,
                workspaceRepository = workspaceRepository,
                textProvider = cardsTextProvider(context = application)
            )
        }
    }
}

fun createCardEditorViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    editingCardId: String?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            val application = requireApplication()
            CardEditorViewModel(
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository,
                editingCardId = editingCardId,
                textProvider = cardsTextProvider(context = application)
            )
        }
    }
}

fun createLibraryViewModelFactory(
    workspaceRepository: WorkspaceRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            LibraryViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

fun createCatalogViewModelFactory(
    catalogBrowseIndexRepository: CatalogBrowseIndexRepository,
    catalogDeckPageRepository: CatalogDeckPageRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            val application = requireApplication()
            CatalogViewModel(
                catalogBrowseIndexRepository = catalogBrowseIndexRepository,
                catalogDeckPageRepository = catalogDeckPageRepository,
                messageController = messageController,
                strings = createCatalogStringResolver(context = application)
            )
        }
    }
}

fun createCatalogDeckViewModelFactory(
    packageId: String,
    catalogBrowseIndexRepository: CatalogBrowseIndexRepository,
    catalogDeckPageRepository: CatalogDeckPageRepository,
    catalogDeckInstallRepository: CatalogDeckInstallRepository,
    messageController: TransientMessageController,
    technicalErrorController: AppTechnicalErrorController,
    requestReviewFilter: (ReviewFilter) -> Unit
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            val application = requireApplication()
            CatalogDeckViewModel(
                packageId = packageId,
                catalogBrowseIndexRepository = catalogBrowseIndexRepository,
                catalogDeckPageRepository = catalogDeckPageRepository,
                catalogDeckInstallRepository = catalogDeckInstallRepository,
                messageController = messageController,
                technicalErrorController = technicalErrorController,
                requestReviewFilter = requestReviewFilter,
                strings = createCatalogStringResolver(context = application)
            )
        }
    }
}

private fun CreationExtras.requireApplication(): Application {
    return checkNotNull(this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY])
}
