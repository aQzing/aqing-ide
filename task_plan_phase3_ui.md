# Task Plan: Phase 3-5 UI 功能补全（第二轮）

## Goal
完成以下 4 个功能点：
1. 资源管理器选中文件高亮（activeTabId 对应的文件节点高亮）
2. 资源管理器旁边新增"定位当前文件"图标按钮（展开并滚动到当前打开文件）
3. Tab 栏右键菜单：关闭当前/左边/右边/其它/所有窗口
4. 文件树右键菜单扩展：新建文件、新建文件夹、剪切、复制、粘贴、复制路径、复制相对路径、重命名、添加到对话、在访达中显示、删除

## Current Phase
in_progress

---

## Phases

### Phase A: 资源管理器文件高亮
- 文件：`FileTreeNode.tsx`
- 方案：接收 `activeFilePath` prop，节点 path === activeFilePath 时背景高亮（#094771）
- 需要从 `AppLayout` → `Sidebar` → `FileTree` → `FileTreeNode` 逐层传递

### Phase B: 定位当前文件图标
- 文件：`FileTree.tsx`（工具栏新增按钮）、`AppLayout.tsx`（传递 activeTabId）
- 方案：
  1. 工具栏新增"定位"图标（靶心/箭头 SVG）
  2. 点击时：根据 activeFilePath 计算所有父目录路径，批量 toggleExpand 展开
  3. 展开后 scrollIntoView 滚动到对应节点（用 ref 或 data-path 属性）

### Phase C: Tab 栏右键菜单
- 文件：`TabBar.tsx`
- 方案：
  1. Tab 右键弹出菜单（fixed 定位）
  2. 菜单项：关闭当前、关闭左边所有、关闭右边所有、关闭其它、关闭所有
  3. 需要 `onCloseOthers`、`onCloseLeft`、`onCloseRight`、`onCloseAll` 回调
  4. 在 `editorStore.ts` 新增对应方法
  5. 在 `EditorArea.tsx` 传递回调

### Phase D: 文件树右键菜单扩展
- 文件：`FileTreeNode.tsx`
- 新增菜单项（参考截图）：
  - 新建文件（已有）
  - 新建文件夹（已有）
  - 分隔线
  - 剪切（记录剪切路径到 clipboardStore 或 useState）
  - 复制（记录复制路径）
  - 粘贴（若有剪切/复制记录则执行）
  - 分隔线
  - 复制路径（已有）
  - 复制相对路径（新增）
  - 分隔线
  - 重命名（已有）
  - 添加到对话（调用 onAddToChat 回调）
  - 在文件管理器中显示（invoke shell open）
  - 分隔线
  - 删除（已有，红色）

## Key Decisions
- 剪切/复制/粘贴：使用组件内 useState 存储 clipboard（不需要全局 store，因为只在文件树内使用）
- "添加到对话"：需要从 AppLayout 传递回调，将文件路径/内容发送到 ChatPanel
- "在文件管理器中显示"：Windows 用 `explorer /select,{path}`，通过 Tauri shell 执行

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| - | - | - |
