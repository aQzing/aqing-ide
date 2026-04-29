---
name: AQingCode Phase 3-5 实现状态
description: Phase 3（AI 配置）、Phase 4（Ghost Text 补全）、Phase 5（Chat 面板）已完成的关键架构决策
type: project
---

Phase 3-5 已于 2026-04-10 完成代码实现（待 VS Build Tools 安装后运行验证）。

**Why:** 用户需要 AI 原生 IDE 的核心 AI 功能，包括模型配置、内联补全和 Chat 对话。

**How to apply:** 后续开发 Phase 6+ 时，AI 调用层已就绪，直接复用 `ai_chat_stream` / `ai_complete` Rust 命令和 `useAiSettingsStore` hook。

## 关键架构决策

- AI 请求全部通过 Rust Command 代理（`ai_chat_stream` / `ai_complete`），API Key 不暴露前端
- 流式 SSE：Rust 端用 `futures_util::StreamExt` 消费 reqwest bytes_stream，通过 `app.emit("ai-stream-{requestId}", payload)` 推送；前端用 `listen("ai-stream-{requestId}", handler)` 接收
- 设置存储：`tauri-plugin-store`，store 名 `"settings"`，key `"aiSettings"`
- Ghost Text：`monaco.languages.registerInlineCompletionsProvider("*", provider)`，防抖 300ms，调用 `ai_complete` 命令
- 设置面板：模态框，从 ActivityBar 底部设置图标触发（`onOpenSettings` prop）

## 新增文件
- `src/store/aiSettingsStore.ts` — AI 设置 store（4 种提供商配置）
- `src/components/layout/SettingsModal.tsx` — 设置模态框
- `src-tauri/src/lib.rs` — 新增 `ai_chat_stream` / `ai_complete` 命令

## 新增 Cargo 依赖
- `reqwest = { version = "0.12", features = ["json", "stream"] }`
- `tokio = { version = "1", features = ["full"] }`
- `futures-util = "0.3"`
