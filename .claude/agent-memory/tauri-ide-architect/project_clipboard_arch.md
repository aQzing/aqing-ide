---
name: 文件树剪贴板架构
description: 文件树复制/剪切/粘贴功能的架构决策：用 React Context 替代模块级变量，Rust 端新增 copy_path_safe/move_path_safe 命令
type: project
---

文件树剪贴板从模块级变量（`let clipboard`）重构为 React Context（`ClipboardContext.tsx`），解决了跨节点状态不同步导致"粘贴"按钮始终 disabled 的 bug。

新增文件：`src/components/explorer/ClipboardContext.tsx`

Rust 端新增两个命令（`src-tauri/src/lib.rs`）：
- `copy_path_safe(src_path, dest_dir)` — 复制到目标目录，自动处理同名冲突（追加 " (copy)" / " (copy N)"），返回实际路径
- `move_path_safe(src_path, dest_dir)` — 移动到目标目录，同样自动处理冲突，源目标同目录时直接返回

**Why:** 旧实现用模块级变量，React 无法感知变化，导致右键菜单"粘贴"按钮的 disabled 状态不更新；路径拼接逻辑分散在前端，容易出错。

**How to apply:** 后续所有文件树操作的剪贴板状态都通过 `useClipboard()` hook 读写，不要再用模块级变量。键盘快捷键在 `FileTree.tsx` 的 `handleKeyDown` 中处理，通过 `isFocusInEditor()` 检测避免劫持 Monaco 编辑器的 Ctrl+C/V。
