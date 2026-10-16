# Clay Chat

独立的 AI 对话工作台，支持网页版与 **Tauri 2 Windows 桌面端**。两端共用 React、TypeScript 与 Vite 界面，复用 [Open Claude UI](https://github.com/Caho1/open-claude-ui) 的主题、按钮、动效和滚动逻辑。

## 启动

需要 Node.js 22.12 或更新版本。桌面开发需要 Rust 与 Windows WebView2；本机已具备工具链。

```powershell
cd D:\src\dodoaling\code\clay-chat
npm ci
```

网页版：

```powershell
npm run dev
```

打开 http://127.0.0.1:5180 。保持终端开启，Ctrl+C 停止。

桌面开发版：

```powershell
npm run desktop:dev
```

Tauri 会启动开发网页服务并打开桌面窗口。如果 5180 已被另一份本项目开发服务占用，先停止该服务，再启动桌面开发。

构建独立桌面程序：

```powershell
npm run build:desktop
```

Windows 产物为 `src-tauri/target/release/clay-chat.exe`，内嵌网页资源和 Rust 后端，运行不需要 Node 或网页服务。依赖系统 WebView2。

构建 Windows 安装包：

```powershell
npm run package:desktop
```

产物位于 `src-tauri/target/release/bundle/nsis/`。尚未配置代码签名或自动更新。

网页版生产运行：

```powershell
npm run build
npm start
```

默认只监听本机 127.0.0.1:5180。PowerShell 可用 `$env:PORT='5182'` 指定端口。当前为个人本地应用；公开为多用户网站前需增加身份验证、服务端凭据管理与配额。

## 功能

- 首次进入为**离线演示模式**，回复为明确标注的预设文本，不调用大模型。
- 「设置」中支持 OpenAI 兼容 `/chat/completions` 与 Claude `/messages`。填写接口地址、模型 ID、API Key 后即可真实对话；兼容本地服务，可留空 Key。
- 支持流式回复、Markdown、代码复制、停止生成、重新生成、本地会话、搜索、收藏、删除、明暗主题与 Markdown 导出。
- 文本与源码附件：每条最多 4 个，每个不超过 200 KB；内容随消息发送给所选模型。暂不支持 PDF 解析、图像识别、工具执行或自动同步。
- Ctrl/Cmd+N 新对话，Ctrl/Cmd+K 搜索，Enter 发送，Shift+Enter 换行，包含中文输入法保护。

## 数据与架构

```text
共享 React 界面
├─ 网页：同源 Node 代理 → 模型服务
└─ Tauri：Rust reqwest → 模型服务 → Tauri Channel 流式回传
```

- 网页会话保存在浏览器 localStorage，Key 仅保存在当前标签页 sessionStorage。
- 桌面会话保存在应用数据目录 `app.claychat.desktop/workspace.json`；Key 使用操作系统凭据库（Windows Credential Manager），不会写入会话文件。
- 桌面程序内嵌构建后的前端，由 Rust 处理网络请求、取消、持久化与文件导出；无需捆绑 Node 或 Chromium。
- 原生命令仅开放给本地 `main` 窗口，按 Tauri capabilities 限制；模型 Markdown 不允许执行 HTML。
- `CLAY_CHAT_DATA_DIR` 可指定隔离数据目录，主要用于测试；也会隔离系统凭据的账户名。

## 目录

```text
src/                共享界面、会话逻辑、网页与原生传输适配
src/vendor/cds/     独立复制的 Open Claude UI 组件与主题
server/             网页同源服务及双协议代理
src-tauri/          Tauri 2、Rust 模型请求、本地数据与系统凭据
scripts/            网页和原生桌面验证
tests/              网页代理与 SSE 边界测试
licenses/           上游 MIT 许可证
```

运行不依赖相邻 `open-claude-ui` 项目。复制源为提交 `ddf3aea`，原始许可保留于 [licenses/open-claude-ui-LICENSE](licenses/open-claude-ui-LICENSE)。

## 验证

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:ui
npm run test:desktop
```

原生验证需先构建桌面程序；可用 `CLAY_CHAT_DESKTOP_BINARY` 指定其他构建路径。测试使用本机模拟模型服务，不发送真实付费请求。上线前应使用自己的模型服务检查可用性和兼容性。

参考：[Tauri Channels](https://v2.tauri.app/develop/calling-frontend/#channels)、[Tauri Capabilities](https://v2.tauri.app/security/capabilities/)、[Claude Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)。
