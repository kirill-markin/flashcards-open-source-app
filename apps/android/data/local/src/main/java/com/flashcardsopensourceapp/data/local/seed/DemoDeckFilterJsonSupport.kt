package com.flashcardsopensourceapp.data.local.seed

import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.cards.encodeDeckFilterDefinitionJson

fun encodeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    return encodeDeckFilterDefinitionJson(filterDefinition = filterDefinition)
}
