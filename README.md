# AQing IDE

基于 Tauri 2.x + React + TypeScript 构建的轻量级桌面 IDE，集成 AI 对话能力。

## 功能特性

- **文件资源管理器** — 文件树浏览、新建/重命名/删除、剪切/复制/粘贴、全局搜索
- **代码编辑器** — 基于 Monaco Editor，支持语法高亮、多标签页
- **集成终端** — 基于 xterm.js，支持多终端标签
- **AI 聊天面板** — 内置 AI 对话，支持流式输出，可配置模型和 API Key
- **布局系统** — 可拖拽调整侧边栏/终端面板宽高，Activity Bar 快速切换视图

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.x |
| 前端框架 | React 19 + TypeScript |
| 编辑器 | Monaco Editor |
| 终端 | xterm.js |
| 样式 | Tailwind CSS 4 |
| 构建工具 | Vite 7 |
| 后端 | Rust (tokio + reqwest) |

## 开发环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri CLI 前置依赖](https://tauri.app/start/prerequisites/)

## 快速开始

```bash
# 进入项目目录
cd AQingIde

# 安装前端依赖
npm install

# 启动开发模式（同时启动 Vite 和 Tauri）
npm run tauri dev
```

## 构建发布包

```bash
cd AQingIde
npm run tauri build
```

构建产物位于 `AQingIde/src-tauri/target/release/bundle/`。

## 项目结构

```
AQingIde/
├── src/                        # React 前端源码
│   ├── components/
│   │   ├── editor/             # 编辑器组件（Monaco + 标签栏）
│   │   ├── explorer/           # 文件树、搜索面板
│   │   ├── layout/             # 整体布局、侧边栏、聊天面板
│   │   └── terminal/           # 终端组件
│   ├── hooks/                  # 自定义 Hooks
│   └── store/                  # 状态管理（编辑器、文件树、AI 设置）
└── src-tauri/                  # Rust 后端源码
    ├── src/
    │   └── lib.rs              # Tauri 命令（文件系统、AI 流式请求等）
    └── tauri.conf.json         # Tauri 配置
```

## License

MIT
