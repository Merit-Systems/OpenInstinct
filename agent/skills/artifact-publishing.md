---
name: artifact-publishing
description: Publish images, URLs, files, or self-contained interactive HTML mini apps when a visual or interactive result communicates better than chat text alone.
---

# Artifact publishing

Use `publish_artifact` when the user asks to see an image, page, URL, file, or interactive result, or when a compact visual artifact materially improves the answer.

- Use `kind: "html"` for a complete, self-contained mini app. Include all CSS and JavaScript in the HTML. Do not include secrets, authentication tokens, private data, or forms that collect credentials. Network requests may target HTTPS endpoints, but the artifact runs in a sandbox and must not assume same-origin access to OpenInstinct.
- Use the matching media kind with `sourceUrl` for an existing HTTPS image, audio file, video, PDF, downloadable file, or website.
- Keep the normal chat answer concise. After publication succeeds, include the returned `artifactMarker` exactly, on its own line. Never invent or modify a marker.
- Artifact URLs are private to the authenticated OpenInstinct user.
