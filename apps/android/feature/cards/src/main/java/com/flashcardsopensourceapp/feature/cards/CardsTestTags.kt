package com.flashcardsopensourceapp.feature.cards

import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel

const val cardsCardRowTag: String = "cards_card_row"
const val cardsCardFrontTextTag: String = "cards_card_front_text"
const val cardsSearchFieldTag: String = "cards_search_field"
const val cardsEmptyStateTag: String = "cards_empty_state"
const val cardsAddCardButtonTag: String = "cards_add_card_button"
const val cardEditorFrontSummaryCardTag: String = "card_editor_front_summary_card"
const val cardEditorBackSummaryCardTag: String = "card_editor_back_summary_card"
const val cardEditorTagsSummaryCardTag: String = "card_editor_tags_summary_card"
const val cardEditorSaveButtonTag: String = "card_editor_save_button"
const val cardEditorFrontTextFieldTag: String = "card_editor_front_text_field"
const val cardEditorBackTextFieldTag: String = "card_editor_back_text_field"
const val cardTagsInputFieldTag: String = "card_tags_input_field"
const val cardTagsAddButtonTag: String = "card_tags_add_button"

fun cardEditorEffortLevelTag(effortLevel: EffortLevel): String {
    return "card_editor_effort_${effortLevel.name.lowercase()}"
}
