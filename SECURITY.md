# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

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

- **No external network**: No `fetch` to third-party servers. Only `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage` locally, and DOM injection into the active AI tab the user already visits.
- **UCI validation**: All moves are validated via regex `^[a-h][1-8][a-h][1-8][qrbn]?$` and legal-move engine before applying.
- **Minimal permissions**: Only `sidePanel`, `activeTab`, `scripting` + explicit AI hosts. No `<all_urls>`.
- **Safe DOM**: Uses `textContent`, `createElement`, no `innerHTML` with untrusted strings.
- **Isolated content script**: Guards against double-load via `window.__AI_CHESS_COMPANION_LOADED__`.

If you find a bypass, please report privately as above. Thank you for helping keep users safe!
