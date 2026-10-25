# Clay Chat

- 独立项目，网页与桌面共享 React/TypeScript 界面；桌面使用 **Tauri 2 + Rust**，不要重新引入 Electron 或打包 Node sidecar。
- 网页模型调用经 `web/` 同源代理；桌面经 `desktop/src-tauri/` reqwest 与 Tauri Channel。两端保持协议、流式取消与错误处理一致。`src/` 是两端共享界面，不归属某一端。
- 默认离线演示必须明确标注。真实对话需用户配置接口与模型，不内置或读取其他项目的 Key。
- 网页 Key 仅用 sessionStorage；桌面 Key 使用系统凭据库，不写入 workspace.json、日志、导出或 Git。
- `src/vendor/cds/` 来自 Open Claude UI；保留上游 MIT 许可，主题使用温暖的陶土色和轻灰表面，支持明暗主题及中文输入法保护。
- 前端修改执行 `npm run build`，交互或代理修改执行相关 `npm test` / `npm run test:ui`。Rust 逻辑修改执行 `cargo test --manifest-path desktop/src-tauri/Cargo.toml`；原生行为修改构建后执行 `npm run test:desktop`。
- 原生 UI 测试使用隔离数据目录和模拟模型接口，避免真实付费请求。分发构建使用 `npm run package:desktop`。
