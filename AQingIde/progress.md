
## Session: 2026-04-13 (修复 FileTree.tsx Bug)

### 问题诊断
- `FileTree.tsx` 存在结构性 Bug：早期 return（"尚未打开文件夹"）缺少 `if (!rootPath) {` 条件包裹，导致：
  - 组件始终渲染空状态，永远不展示文件树
  - TypeScript 报 TS1128 "Declaration or statement expected"（第393行）
- 渲染根节点的 `<FileTreeNode>` 缺少 `selectedPath` 和 `onSelect` props
- 调用了未定义的函数 `findNodeByPath`（应为 `findNode`）
- 存在两个重复的键盘事件处理器（`useCallback handleKeyDown` + 第二个 `useEffect`）
- `targetDir` 未使用变量（TS6133 unused variable）
- `rootExpanded / setRootExpanded` 未使用变量（TS6133）
- `getParentPath` 函数在 `FileTree.tsx` 中未定义（只在 `FileTreeNode.tsx` 中有）

### 修复内容
- 在第 257 行前补上 `if (!rootPath) {` 条件守卫
- 删除重复的第二个键盘 useEffect（保留 `useCallback handleKeyDown` 版本）
- 根节点 `<FileTreeNode>` 补传 `selectedPath={selectedPath}` 和 `onSelect={setSelectedPath}`
- `findNodeByPath` → `findNode`（统一命名）
- 删除 `targetDir` 未使用变量
- 删除 `rootExpanded / setRootExpanded` 未使用变量
- 在文件末尾添加 `getParentPath` 辅助函数

### TypeScript 验证
- `npx tsc --noEmit` 零错误 ✅
