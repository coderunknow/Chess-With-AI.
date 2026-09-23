# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-23

### Added
- Initial release of **AI Chess Companion** Chrome Extension (Manifest V3)
- Side panel chess board UI (`sidepanel.html`) with dark theme, Unicode pieces, legal-move highlights, last-move indicator, FEN display, turn indicator
- Full local chess engine in `sidepanel.js`:
  - FEN parsing and generation
  - Pseudo-legal + legal move validation
  - Check detection, pinned pieces, castling, en passant, promotion (queen default)
  - History tracking
- Background service worker (`background.js`):
  - `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
  - Enables panel only on supported AI hosts
  - Handles tab updates, activation, removal
  - Provides `GET_ACTIVE_TAB` messaging
- Content script bridge (`content.js`):
  - Robust chat input detection (textarea, contenteditable, role=textbox)
  - Native value setter to support React-controlled inputs
  - Send button detection + Enter key fallback
  - MutationObserver for AI response parsing — looks for `[e2e4]` UCI in brackets
  - Debouncing / duplicate suppression for AI moves
- Manifest with permissions: `sidePanel`, `activeTab`, `scripting` + host permissions for:
  - gemini.google.com
  - chatgpt.com / chat.openai.com
  - claude.ai
  - grok.com
  - perplexity.ai
  - copilot.microsoft.com
- Public docs: README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, PRIVACY, SUPPORT, CHANGELOG
- GitHub templates for issues and PRs

### Security
- Minimal permissions, no external network calls, UCI regex validation

[1.0.0]: https://github.com/coderunknow/Chess-With-AI/releases/tag/v1.0.0
