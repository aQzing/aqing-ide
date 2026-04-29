---
name: Windows Rust 链接器冲突
description: 用户 Windows 环境中 Git 的 GNU link.exe 优先于 MSVC link.exe，导致 cargo check 失败，且系统未安装 VS Build Tools
type: project
---

系统 PATH 中 `C:\develop\Git\usr\bin\link.exe`（GNU ld）排在 MSVC `link.exe` 前面，且系统未安装 Visual Studio Build Tools（无 `cl.exe`）。

**Why:** Rust 工具链为 `stable-x86_64-pc-windows-msvc`，需要 MSVC 链接器，但系统只有 Git 附带的 GNU 工具。

**How to apply:** 每次涉及 Rust 编译问题时，提醒用户先安装 VS Build Tools 2022（C++ 工作负载）。下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/
安装后选择「使用 C++ 的桌面开发」工作负载即可，不需要完整 Visual Studio。
