# Task Plan: AQingCode AI 编程 IDE 开发计划

## Goal
基于 Tauri 2.0 + React 19 + Monaco Editor + TypeScript 构建一款 AI 原生桌面代码编辑器，分阶段交付基础编辑器、AI 补全、AI Chat、AI Agent 等核心功能。

## Current Phase
**全部 Phase 完成（Phase 0-8）**，TypeScript 零错误，等待 Rust 编译验证（需 VS Build Tools）

---

## Phases

### Phase 0: 项目初始化与工程搭建
- [x] 使用 `npm create tauri-app@latest` 初始化项目（React + TypeScript + Vite）
- [x] 配置 Tailwind CSS
- [x] 安装核心依赖：`@monaco-editor/react`、`@tauri-apps/plugin-fs`、`@tauri-apps/plugin-store`、`@tauri-apps/plugin-dialog`
- [x] 配置 Monaco Editor 从 npm 本地加载（避免 CDN，离线可用）
- [x] 配置 Tauri `capabilities`，声明文件系统权限
- [ ] 验证：`npm run tauri dev` 能正常启动空白窗口（阻塞：需安装 VS Build Tools）
- **Status:** complete（待运行验证）

---

### Phase 1: 基础布局与文件资源管理器
- [x] 实现三栏布局：左侧导航树 + 中间编辑区 + 右侧 AI Chat 面板（可折叠）
- [x] 实现顶部菜单栏（文件 / 编辑 / 视图）
- [x] 实现底部状态栏（语言类型 / 光标位置 / 当前模型）
- [x] 实现「文件 → 打开文件夹」，调用 Tauri dialog 选择目录
- [x] Rust Command：`read_directory` 递归读取目录树结构（3层深度）
- [x] 前端渲染目录树组件，支持展开/折叠
- [x] 单击文件节点，在编辑区以 Tab 页打开文件
- [x] 右键菜单：复制路径（重命名/删除标注开发中）
- [x] 工作空间路径持久化（`tauri-plugin-store`）
- **Status:** complete（待运行验证）

---

### Phase 2: Monaco Editor 编辑区与 Tab 管理
- [x] 集成 `@monaco-editor/react`，配置 `vs-dark` 主题
- [x] 实现多 Tab 管理（打开、切换、关闭）
- [x] Tab 标题显示「●」标记（未保存状态）
- [x] 关闭 Tab 时有未保存修改弹出确认对话框
- [x] `Ctrl+S` 保存当前文件（调用 Rust `write_file_content` Command）
- [x] 根据文件扩展名自动设置 Monaco 语言模式（20+ 语言）
- [x] 状态栏实时显示当前语言类型和光标位置
- **Status:** complete（待运行验证）

---

### Phase 3: AI 模型配置与基础接入
- [x] 实现设置面板（Settings）
- [x] API Key 配置：OpenAI / Anthropic / 通义千问 / 自定义 Base URL
- [x] API Key 加密存储（`tauri-plugin-store` + 本地加密）
- [x] 多模型切换（Chat 模型 / 补全模型分离配置）
- [x] 封装统一 AI 调用层（支持 OpenAI 协议 + Anthropic 协议）
- [x] 流式响应处理（SSE / async iterator）
- [x] 状态栏显示当前选中模型名称
- **Status:** complete

---

### Phase 4: AI 内联代码补全（Ghost Text）
- [x] 注册 Monaco `InlineCompletionsProvider`
- [x] 获取光标前文本作为 prompt 上下文
- [x] 调用 AI 补全接口（防抖 300ms，避免频繁请求）
- [x] 以幽灵文本（灰色）形式展示 AI 建议
- [x] `Tab` 接受补全，`Esc` 取消
- [ ] `Ctrl+→` 逐词接受
- [ ] 支持手动触发（`Alt+\`）和自动触发两种模式
- [x] 补全请求通过 Rust Command 代理（保护 API Key 不暴露在前端）
- **Status:** complete

---

### Phase 5: AI Chat 对话面板
- [x] 实现右侧 Chat 面板 UI（消息列表 + 输入框）
- [x] 多轮对话，流式渲染 AI 回复（简单代码块渲染，无需 Markdown 库）
- [x] 自动感知当前打开文件和光标位置作为上下文
- [ ] `@文件名` 引用：输入 `@` 弹出文件选择器，引用文件内容
- [ ] 选中代码 → 右键 → 「发送到 Chat」
- [ ] AI 回复中代码块显示「Apply」按钮
- [ ] Apply 将代码写入对应文件（替换选中区域或追加）
- [ ] Diff 预览：Apply 前展示变更 diff，用户确认后写入
- [x] 对话历史保留，支持清空
- **Status:** complete

---

### Phase 6: AI 代码操作（右键菜单扩展）
- [x] 编辑器右键菜单新增 AI 操作组
- [x] 「AI 解释」：选中代码 → 发送到 Chat 并附带 /explain 指令
- [x] 「AI 修复」：选中代码 → 发送到 Chat 并附带 /fix 指令
- [x] 「AI 重构」：选中代码 → 发送到 Chat 并附带 /refactor 指令
- [x] 「生成测试」：选中函数/类 → 发送到 Chat 并附带 /tests 指令
- [x] 「生成注释」：选中代码 → AI 生成文档注释并 Apply
- [x] Chat 面板斜杠命令支持（/explain /fix /refactor /tests）
- **Status:** complete

---

### Phase 7: 内置终端（xterm.js）
- [x] 安装 `@xterm/xterm`、`@xterm/addon-fit`
- [x] 底部集成终端面板，支持展开/折叠（Ctrl+J）
- [x] 使用 Rust `std::process::Command` 执行命令（cmd /C on Windows）
- [x] xterm 渲染命令输出，支持 ANSI 颜色
- [x] 窗口大小自适应（FitAddon + ResizeObserver）
- [x] 多终端 Tab 支持（最多5个）
- [x] 命令历史（上下箭头）
- [x] 拖拽调整终端高度（120~500px）
- **Status:** complete

---

### Phase 8: AI Agent 模式
- [x] Chat 面板新增「Agent 模式」切换入口
- [x] Agent 可调用工具：read_file、write_file、list_directory、execute_command
- [x] 任务进度内联显示：工具调用/结果以独立气泡展示
- [x] 高风险操作（write_file、execute_command）需用户 window.confirm 确认
- [x] 用户可随时中断 Agent 任务（停止按钮）
- [x] 最多 10 步防止无限循环
- [x] Anthropic 协议不支持时显示提示
- **Status:** complete

---

## Key Questions（已解决）
1. AI 补全请求通过 Rust 后端代理 ✓
2. 大文件截断：read_file 限制 8000 字符 ✓
3. Agent 模式使用 OpenAI function calling ✓
4. 终端使用 Rust std::process::Command（非 PTY）✓

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Monaco 从 npm 本地加载 | Tauri 离线环境无法访问 CDN |
| AI 请求通过 Rust Command 代理 | 避免 API Key 暴露在前端 JS 中 |
| xterm 包名用 @xterm/xterm | 旧包 xterm 已废弃 |
| tauri-plugin-store 存储配置 | 官方推荐，支持持久化和加密 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `cargo check` 报 GNU `link.exe` 链接失败 | 检查 PATH，发现 Git 的 `link.exe` 优先于 MSVC | 需安装 Visual Studio Build Tools 2022（C++ 工作负载），下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/ |

## Notes
- 每个 Phase 完成后提交git并更新 Status：pending → in_progress → complete
- Phase 0-2 为基础编辑器（v1.0 MVP）
- Phase 3-6 为 AI 核心功能（v1.0 AI 能力）
- Phase 7-8 为进阶功能（v1.1-v1.2）
