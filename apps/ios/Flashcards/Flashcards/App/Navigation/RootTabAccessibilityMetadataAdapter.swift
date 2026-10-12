import SwiftUI
import UIKit

struct RootTabAccessibilityMetadataAdapter: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MetadataController {
        MetadataController()
    }

    func updateUIViewController(_ uiViewController: MetadataController, context: Context) {
        uiViewController.applyAccessibilityIdentifiers()
    }

    final class MetadataController: UIViewController {
        override func viewDidLoad() {
            super.viewDidLoad()
            self.view.backgroundColor = .clear
            self.view.isUserInteractionEnabled = false
            self.view.isAccessibilityElement = false
            self.view.accessibilityElementsHidden = true
        }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            self.applyAccessibilityIdentifiers()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            self.applyAccessibilityIdentifiers()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            self.applyAccessibilityIdentifiers()
        }

        func applyAccessibilityIdentifiers() {
            // Matches the fixed root Tab declaration order; customization needs a new mapping.
            let identifiers: [String] = [
                UITestIdentifier.rootTabReviewItem,
                UITestIdentifier.rootTabProgressItem,
                UITestIdentifier.rootTabAIItem,
                UITestIdentifier.rootTabCardsItem,
                UITestIdentifier.rootTabSettingsItem
            ]
            guard UIDevice.current.userInterfaceIdiom == .phone,
                  let items = self.tabBarController?.tabBar.items,
                  items.count == identifiers.count else {
                return
            }

            for (item, identifier) in zip(items, identifiers) where item.accessibilityIdentifier != identifier {
                item.accessibilityIdentifier = identifier
            }
        }
    }
}
