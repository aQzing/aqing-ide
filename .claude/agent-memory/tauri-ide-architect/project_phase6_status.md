---
name: Phase 6 实现状态
description: AI 代码操作右键菜单扩展已完成，组件间通信架构和关键实现细节
type: project
---

Phase 6 已完成：Monaco Editor 右键菜单 AI 操作组 + Chat 面板斜杠命令支持。

**Why:** 用户需要在编辑器中选中代码后，通过右键菜单快速触发 AI 操作（解释/修复/重构/测试/注释）。

**How to apply:** 后续扩展 AI 菜单项时，在 EditorPane.tsx 的 handleMount 中调用 registerChatAction 即可。

## 关键架构决策

editorStore.ts 使用 React useState 模式（非 Zustand），无法跨组件直接订阅。
解决方案：pendingChatCommand 状态提升到 AppLayout，通过 props 向下传递。

数据流：EditorPane → onAiCommand prop → AppLayout.handleAiCommand → pendingChatCommand state → ChatPanel prop

## 新增类型（editorStore.ts）

- `AiChatCommandType`: '/explain' | '/fix' | '/refactor' | '/tests'
- `PendingChatCommand`: { command, code, language, timestamp }

## 各文件变更摘要

- `src/store/editorStore.ts`: 新增 AiChatCommandType 和 PendingChatCommand 类型导出
- `src/components/editor/EditorPane.tsx`: 新增 onAiCommand prop，handleMount 中注册5个右键菜单项
- `src/components/layout/EditorArea.tsx`: 新增 onAiCommand prop 透传
- `src/components/layout/AppLayout.tsx`: 新增 pendingChatCommand state + handleAiCommand，Chat 面板收到命令时自动展开
- `src/components/layout/ChatPanel.tsx`: 新增 pendingChatCommand/onClearPendingCommand props，useEffect 监听并填充输入框

## 注意事项

- addAction 的 run 回调参数类型是 ICodeEditor（非 IStandaloneCodeEditor），getSelectedCode 辅助函数使用 editor.ICodeEditor
- 原有代码中存在4个 TS 错误（debounce 类型、freeInlineCompletions 等），Phase 6 未引入新错误
- 「生成注释」走 ai_complete 命令（非流式），其余4个走 Chat 流程
