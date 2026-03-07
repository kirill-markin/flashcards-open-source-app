import SwiftUI

struct ReviewView: View {
    let cards: [ReviewCard]

    @State private var currentIndex: Int = 0
    @State private var isAnswerVisible: Bool = false
    @State private var completedCount: Int = 0
    @State private var lastSubmittedGrade: ReviewGrade? = nil

    var body: some View {
        Group {
            if cards.isEmpty {
                ContentUnavailableView(
                    "No Cards Yet",
                    systemImage: "tray",
                    description: Text("Add cards once the local storage layer is ready.")
                )
            } else if completedCount == cards.count {
                completionView
            } else {
                activeCardView
            }
        }
        .navigationTitle("Review")
        .toolbar {
            if cards.isEmpty == false && completedCount < cards.count {
                ToolbarItem(placement: .topBarTrailing) {
                    Text("\(currentIndex + 1)/\(cards.count)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var currentCard: ReviewCard {
        cards[currentIndex]
    }

    private var activeCardView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(currentCard.deckTitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 16) {
                    Text("Front")
                        .font(.caption)
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)

                    Text(currentCard.prompt)
                        .font(.title2)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                if isAnswerVisible {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Back")
                            .font(.caption)
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)

                        Text(currentCard.answer)
                            .font(.title3)
                            .fontWeight(.medium)

                        Text(currentCard.note)
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(24)
                    .background(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(Color(uiColor: .secondarySystemBackground))
                    )
                }

                if isAnswerVisible {
                    VStack(spacing: 12) {
                        ForEach(ReviewGrade.allCases) { grade in
                            Button(action: {
                                submitGrade(grade: grade)
                            }) {
                                Label(grade.rawValue, systemImage: grade.symbolName)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                } else {
                    Button(action: {
                        isAnswerVisible = true
                    }) {
                        Label("Show answer", systemImage: "eye")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(20)
        }
    }

    private var completionView: some View {
        ContentUnavailableView {
            Label("Done for now", systemImage: "checkmark.circle")
        } description: {
            if let lastSubmittedGrade {
                Text("Last card marked \(lastSubmittedGrade.rawValue.lowercased()).")
            } else {
                Text("The sample session is complete.")
            }
        } actions: {
            Button("Review again") {
                restartSession()
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func submitGrade(grade: ReviewGrade) {
        lastSubmittedGrade = grade
        completedCount += 1
        isAnswerVisible = false

        if completedCount < cards.count {
            currentIndex += 1
        }
    }

    private func restartSession() {
        currentIndex = 0
        isAnswerVisible = false
        completedCount = 0
        lastSubmittedGrade = nil
    }
}

#Preview {
    NavigationStack {
        ReviewView(cards: sampleReviewCards())
    }
}
