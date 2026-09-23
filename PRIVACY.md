# Privacy Policy for AI Chess Companion

**Effective Date:** September 23, 2026
**Extension Name:** AI Chess Companion (Chess With AI)
**Version:** 1.0.0

## Summary

**We do not collect, store, or transmit any personal data.**

AI Chess Companion is designed to be privacy-first and fully local. All chess logic runs in your browser. The only network communication is the prompt that *you* already send to your chosen AI chat (Gemini, ChatGPT, Claude, etc.) via the content script that automates typing into that chat's input box.

## What the Extension Does

- Displays a chess board in Chrome's Side Panel
- Validates your moves locally
- Sends your move (UCI like `[e2e4]` + current FEN) to the **currently active AI tab** by programmatically filling that tab's chat input and clicking send
- Observes the AI's response in the DOM to extract a bracketed UCI move like `[e7e5]`

## Data Collection

**None.** We do not:

- Collect personal information
- Use analytics, telemetry, or tracking pixels
- Store data on external servers
- Require API keys
- Access browsing history beyond the active AI tab
- Read data from non-whitelisted sites

## Permissions Justification

Declared in `manifest.json`:

- `sidePanel` — To show the chess board in Chrome's side panel
- `activeTab` — To identify the active AI chat tab and send it your chess move
- `scripting` — To ensure content script is present on AI tabs (fallback injection)
- `host_permissions` — Limited to:
  - `https://gemini.google.com/*`
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`
  - `https://claude.ai/*`
  - `https://grok.com/*`
  - `https://www.perplexity.ai/*`
  - `https://copilot.microsoft.com/*`
  
  These are needed to inject the content script that bridges board ↔ chat. We do not access any other sites.

## Data Storage

- **Local only:** Game state (board, history, FEN) lives in the side panel's JS memory and is reset on panel close or via Reset button. We do not use `chrome.storage` to persist it in v1.0.0.
- No cookies, no localStorage of personal data.

## Third Parties

- The extension does not communicate with any third-party servers operated by us.
- When you make a move, the content script sends a prompt to the AI chat site you are already visiting. That site's own privacy policy then applies to that conversation (e.g., OpenAI, Google, Anthropic).

## Children's Privacy

The extension does not knowingly collect data from anyone, including children.

## Changes to This Policy

If we ever add features that change privacy implications (e.g., optional cloud sync, analytics), we will update this file, bump the major version, and disclose in the Chrome Web Store listing and README.

## Contact

For privacy questions: open an issue on GitHub or email accicloudnha@gmail.com.

## Compliance

This extension aims to comply with Chrome Web Store Developer Program Policies, including the limited use and user data policies.

