---
name: ChatPanel 三大功能增强
description: 代码块复制、消息时间戳、任务规划与 Diff 展示的实现架构
type: project
---

ChatPanel.tsx 在 2026-04-13 完成三项功能增强，全部集成在单文件中。

**功能一：代码块一键复制**
- `CopyButton` 组件：`navigator.clipboard.writeText` + 降级 `execCommand`，1.5s 后恢复
- `renderContent` 函数：代码块头部增加语言标签（蓝色）+ CopyButton，diff 块跳过普通渲染

**功能二：消息时间戳**
- `ChatMessage` 接口新增 `timestamp: number` 字段（`Date.now()`）
- `formatTime(ts)` → `HH:mm`，`formatFullTime(ts)` → `YYYY-MM-DD HH:mm:ss`（title 悬停）
- 用户消息：时间戳在标签行右侧；AI 消息：时间戳在内容下方左对齐

**功能三：任务规划与 Diff 展示**
- `TaskPlan` / `SubTask` 类型：state = pending/confirmed/cancelled，status = pending/running/done/error
- `parseTaskPlan(text)` 解析 `## 任务计划\n1. xxx` 格式，流式完成后自动附加到消息
- `TaskPlanCard` 组件：子任务列表 + 确认/取消按钮，confirmed 状态显示"执行中"徽章
- `FileDiff` / `DiffHunk` / `DiffLine` 类型：标准 unified diff 结构
- `parseDiff(text)` 解析 ` ```diff ` 代码块，流式完成后自动附加到消息
- `DiffBlock` 组件：GitHub 风格（深色 #0d1117 背景），折叠/展开，"应用更改"按钮调用 `write_file_content`
- 复杂需求检测：`isComplexRequest(text)` 判断长度>200 或含≥2个关键词，触发时在系统提示注入任务规划指令

**Why:** 用户要求参考 Claude Code + Trae 风格，提升 AI 对话区的实用性。

**How to apply:** ChatPanel 是单文件组件，所有子组件（CopyButton/TaskPlanCard/DiffBlock/MessageBubble）均在同文件定义，修改时注意组件顺序（被引用者在前）。
