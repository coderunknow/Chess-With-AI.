<!-- Thank you for contributing! -->

## Description

Briefly describe what this PR does and why.

Fixes #(issue)

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / chore
- [ ] Security fix

## How Has This Been Tested?

- [ ] `npm run verify` passes (manifest check + lint + format + tests)
- [ ] Added or updated tests for the change
- [ ] Loaded unpacked in Chrome and tested on:
  - [ ] gemini.google.com
  - [ ] chatgpt.com / chat.openai.com
  - [ ] claude.ai
  - [ ] grok.com / perplexity.ai / copilot.microsoft.com
- [ ] Tested legal moves, castling, en passant, promotion
- [ ] Tested AI move parsing (`[e2e4]`), including an illegal reply
- [ ] Checked the console of the side panel, the content script and the service worker

## Screenshots (if UI change)

Add before/after.

## Checklist

- [ ] I read CONTRIBUTING.md and CODE_OF_CONDUCT.md
- [ ] No new runtime dependencies and no external network requests
- [ ] No new permissions (a new AI host goes into `src/shared/platforms.js` + `npm run sync:manifest`)
- [ ] Used `textContent` / `createElement`, never `innerHTML` with untrusted data
- [ ] `src/core` and `src/shared` still avoid DOM and `chrome.*` access
- [ ] Docs updated (README, `docs/`, CHANGELOG for user-visible changes)
- [ ] AI input/output is validated before use (moves resolved against the legal move list)
- [ ] Keyboard navigation and screen-reader labels still work

## Additional Notes

Anything else reviewers should know.
