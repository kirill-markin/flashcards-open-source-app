---
name: publish-public-flashcard-deck
description: >-
  Create and publish an SEO-ready flashcard deck in this product's public catalog, including cards from a workspace, optional card images and cover media, catalog review, website rebuild, and live verification. Use for "create or publish a public deck" and "add a deck to the catalog". Do not use for private workspace-only decks.
---

# Publish a public flashcard deck

1. Read `AGENTS.md`, the catalog authoring code under `apps/backend/src/catalog/authoring/`, the admin routes in `apps/backend/src/routes/catalog/admin.ts`, and the sibling website's `src/lib/publicCatalogBuild.ts`. Use the current code as the API contract.
2. Agree on the topic, source workspace, ordered cards, author, stable slug, title, summary, Markdown description, language and topic tags, license, content warning, and desired cover. Review all public text and media before publishing.
3. Create or finalize the cards in the source workspace through the agent API. For card images, upload JPEG, PNG, or WebP files through the workspace media endpoints and reference the ready assets with `fcasset:` links. The workspace snapshot flow copies those images into the catalog version automatically.
4. Call the `/v1/admin/catalog` endpoints from a signed-in browser session with CSRF protection; API keys do not authorize admin routes. Create or update the author and package draft. For a cover, attach the uploaded media blob with `POST /v1/admin/catalog/packages/{packageId}/media-assets`, then set `coverPackageMediaKey` on the draft.
5. Snapshot the selected cards in their intended order with `POST /v1/admin/catalog/packages/{packageId}/versions/from-workspace`. Move the immutable version through `draft -> submitted -> approved`, then publish it with the review-status and publish endpoints. Publish only when the user has explicitly authorized making the deck public; corrections after publication require a new version.
6. Verify the published package through `GET /v1/catalog`, rebuild or redeploy the static website so it fetches the new catalog dump, then check the public HTML and Markdown pages, metadata and JSON-LD, sitemap entry, media rendering, and install flow. Report the public URL and package version ID.
