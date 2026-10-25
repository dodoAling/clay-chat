# Clay Chat

**English** | [&#x4E2D;&#x6587;](README.md) · **[github.com/dodoAling/clay-chat](https://github.com/dodoAling/clay-chat)**

[![GitHub stars](https://img.shields.io/github/stars/dodoAling/clay-chat?style=flat&color=c96f4a)](https://github.com/dodoAling/clay-chat/stargazers)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web-9aa7bd)](https://github.com/dodoAling/clay-chat)
[![License](https://img.shields.io/badge/license-MIT-7d8f69)](LICENSE)

The Claude desktop experience, finally under your control. Clay Chat rebuilds the familiar Claude look, motion, and feel on top of Open Claude UI — while the model, keys, and data stay entirely yours. Plug in an OpenAI-compatible service or the Claude API, and every conversation stays on your machine.

What you can do with it:

- **Feels like Claude's desktop app** — streaming replies, Markdown, one-click code copy, and read-as-it-writes scroll pinning; it looks familiar from the first second.
- **Bring your own key, skip the subscription** — any `/chat/completions` endpoint or Anthropic `/messages`, from hosted providers down to local Ollama.
- **Conversations never leave the device** — no accounts, no sync; the desktop stores your key in the Windows Credential Manager, the web keeps it in the tab's sessionStorage.
- **Works before you add a key** — a clearly labeled offline demo plays preset replies out of the box.
- **Native Windows desktop + web** — a few-MB single binary on Tauri 2 + Rust; the same interface runs in the browser.

## Screenshots

![Desktop conversation in the dark theme with Markdown and a code block](docs/media/conversation-desktop-dark.png)

| Light theme | Dark theme |
| --- | --- |
| ![Web conversation with a text attachment and a streamed reply](docs/media/conversation-web.png) | ![Web conversation in the dark theme](docs/media/conversation-dark.png) |
| ![Welcome screen with suggestion cards and the composer](docs/media/welcome.png) | ![Welcome screen in the dark theme](docs/media/welcome-dark.png) |
| ![Mobile layout with the collapsible sidebar](docs/media/welcome-mobile.png) | ![Mobile layout in the dark theme](docs/media/welcome-mobile-dark.png) |
| ![Frameless desktop window with the native titlebar](docs/media/welcome-desktop.png) | ![Desktop window in the dark theme](docs/media/welcome-desktop-dark.png) |

## Start

Requires Node.js 22.12 or later:

```sh
cd /path/to/clay-chat
npm ci
npm run dev
```

Open http://127.0.0.1:5180. Keep the terminal open and press Ctrl+C to stop. The server binds to loopback only; set `PORT` to choose another port.

For production web use, run `npm run build` then `npm start`. `npm run package:web` produces a self-contained bundle at `release/clay-chat-web/` (plus a zip archive): it ships `dist/` assets and the `web/` server only, needs nothing beyond Node.js, and requires no node_modules. This is a personal local application — publishing it as a multi-user site requires authentication, server-side credential management, and quotas.

## Desktop app

The Windows desktop version uses Tauri 2 with a Rust backend: model requests go through reqwest and stream back over a Tauri Channel, conversations persist to the app data directory, and the API key is stored in the operating system credential store. No Node or Chromium is bundled; the system WebView2 is required.

Desktop development needs Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows:

```powershell
npm run desktop:dev
```

Tauri starts the web dev server and opens the desktop window. Stop any other instance of this project's dev server on port 5180 first.

Build a standalone executable (web assets and the Rust backend embedded):

```powershell
npm run build:desktop
```

The output is `desktop/src-tauri/target/release/clay-chat.exe`. Build a Windows installer with `npm run package:desktop`; the NSIS bundle appears under `desktop/src-tauri/target/release/bundle/nsis/`. Code signing and auto-updates are not configured.

## Connect a model

Open **Settings** and choose a connection:

- **Demo** — offline preset replies, clearly labeled in each answer. No network calls.
- **OpenAI-compatible** — any service exposing `/chat/completions`, including local servers such as Ollama; the API key may be left empty when not required.
- **Claude API** — Anthropic `/messages` with `anthropic-version: 2023-06-01`.

Enter the base URL, model ID, and API key, then send a message. Base URLs may include `/v1`; complete endpoint paths are also accepted. An optional system prompt is applied per connection.

Clay Chat is a third-party client and is not affiliated with Anthropic; names and trademarks belong to their respective owners.

## Features

- Streaming replies with Markdown (GFM) rendering, one-click code copy, stop generation, and regenerate.
- Local conversations with pinning, full-text search, deletion with confirmation, and Markdown export.
- Text and source-code attachments: up to 4 per message, 200 KB each, inlined into the outgoing message. PDF parsing, image input, tool execution, and sync are not supported.
- Dark and light themes, responsive layout, suggestion cards, toasts, and a collapsed-sidebar mode.
- Ctrl/Cmd+N new chat, Ctrl/Cmd+K search, Enter to send, Shift+Enter for newline, with composition guards for CJK input methods.

## Data and architecture

```text
Shared React interface
├── Web: same-origin Node proxy → model service
└── Desktop: Rust reqwest → model service → Tauri Channel
```

- Web conversations are stored in `localStorage`; the key is kept only in the current tab's `sessionStorage`.
- Desktop conversations are stored in the app data directory (`app.claychat.desktop/workspace.json`, written atomically); the key uses the OS credential store and never enters the workspace file, logs, exports, or Git.
- The web server enforces a loopback bind, Host/Origin allow-listing, a content-security policy, request size limits, upstream error redaction, and API-key scrubbing in error messages.
- Native commands are exposed only to the local `main` window through Tauri capabilities; model Markdown cannot execute HTML.
- `CLAY_CHAT_DATA_DIR` selects an isolated desktop data directory (and a separate credential identity), mainly for testing.

## Layout

```text
src/                Shared UI, conversation logic, web and native transport adapters
src/vendor/cds/     Vendored Open Claude UI components, theme, motion and scroll pinning
web/                Same-origin web service and the dual-protocol proxy
desktop/src-tauri/  Tauri 2, Rust model requests, local storage and system credentials
scripts/            Web and native desktop verification
tests/              Web proxy and SSE boundary tests
docs/media/         README screenshots
licenses/           Upstream licenses
```

The runtime does not depend on the adjacent `open-claude-ui` repository. The vendored copy is from commit `ddf3aea`; the original license is kept in [licenses/open-claude-ui-LICENSE](licenses/open-claude-ui-LICENSE).

## Verify

```powershell
npm run build
npm test
cargo test --manifest-path desktop/src-tauri/Cargo.toml
npm run test:ui
npm run test:desktop
```

Native verification requires a built desktop binary; point `CLAY_CHAT_DESKTOP_BINARY` at another build path when needed. The suites use a local mock model service and never send real paid requests. Check availability and compatibility against your own model service before release.

## Contact

- Email: [dodoaling@163.com](mailto:dodoaling@163.com)
- X (Twitter): [@DodoAling](https://x.com/DodoAling)
- WeChat: `dodoaling`
- WeChat official account: `DodoAling` — scan the code, or search as shown:

<img src="docs/media/wechat-mp-qr.png" alt="WeChat official account QR code: scan or search for DodoAling" width="420">

## License

MIT — see [LICENSE](LICENSE). Vendored components under `src/vendor/cds/` remain under the [Open Claude UI MIT license](licenses/open-claude-ui-LICENSE).
