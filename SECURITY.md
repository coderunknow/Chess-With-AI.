# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

We currently maintain only the latest `main` branch. If you are on an older unpacked version, please update by pulling `main` and reloading the extension in `chrome://extensions`.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please email **accicloudnha@gmail.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact (e.g., XSS via AI response parsing, privilege escalation via permissions)
- Suggested mitigation if you have one

We aim to acknowledge within 48 hours and provide a fix timeline within 7 days for critical issues.

### What counts as a security issue here?

- Content script injection flaws that could allow an AI page to execute arbitrary code in extension context
- Overly broad permissions or host permissions
- Unsafe DOM parsing (`innerHTML` with untrusted AI output, `eval`, etc.)
- Side panel message handling without validation (e.g., accepting arbitrary `AI_MOVE` without UCI validation)
- Privacy leak (sending data to external servers beyond the AI chat tab user controls)

### What is out of scope?

- AI hallucinating illegal moves — that's expected, we validate and show an error
- AI chat site UI changes breaking selectors — file as a bug, not a security issue
- Chrome Web Store review delays

## Security Practices in this Extension

- **No external network**: no `fetch`, `XMLHttpRequest` or WebSocket anywhere in `src/`; the only traffic is the
  prompt typed into the AI chat tab the user is already visiting. `test/markup.test.js` asserts this.
- **UCI validation**: every candidate move is parsed and matched against the engine's legal move list before it is
  applied; nothing else from a page is trusted.
- **Message validation**: every runtime message is checked against the typed contract in `src/shared/messaging.js`,
  and prompt text is length-bounded before it is typed into a page.
- **Minimal permissions**: `sidePanel`, `scripting`, `storage` plus explicit AI hosts. No `<all_urls>`, no `tabs`.
- **Safe DOM**: `textContent` and `createElement` only — no `innerHTML`, no `eval`, no `new Function`.
- **Isolated content script**: the classic bootstrap and the module entry both guard against double execution; the
  ESM graph is loaded through `web_accessible_resources`, whose completeness is verified in CI.
- **Untrusted storage**: settings and snapshots are validated on read, and an unreplayable snapshot is discarded
  rather than trusted.
- **Zero runtime dependencies**: nothing third-party is shipped in the packaged archive.

If you find a bypass, please report privately as above. Thank you for helping keep users safe!
