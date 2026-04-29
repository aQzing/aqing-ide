import React, { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { ExplorerState, FileNode } from "../../store/explorerStore";
import { FileTreeNode } from "./FileTreeNode";
import { ClipboardProvider, useClipboard } from "./ClipboardContext";

interface FileTreeProps {
  explorer: ExplorerState;
  onOpenFile: (path: string, name: string) => void;
  activeFilePath: string | null;
}

// 计算某个文件路径的所有父目录路径
function getAncestorPaths(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length - 1; i++) {
    ancestors.push(parts.slice(0, i + 1).join("/"));
  }
  return ancestors;
}

function normPath(p: string) {
  return p.replace(/\\/g, "/");
}

function getParentPath(filePath: string): string {
  const normalized = normPath(filePath);
  return normalized.split("/").slice(0, -1).join("/");
}

function findNodePath(nodes: FileNode[], normalizedTarget: string): string | null {
  for (const node of nodes) {
    if (normPath(node.path) === normalizedTarget) return node.path;
    if (node.children) {
      const found = findNodePath(node.children, normalizedTarget);
      if (found) return found;
    }
  }
  return null;
}

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (normPath(node.path) === normPath(path)) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

// ─── 判断当前焦点是否在编辑器区域（Monaco 等），避免劫持快捷键 ────────────────

function isFocusInEditor(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  // Monaco 编辑器的 textarea / contenteditable div
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return true;
  // Monaco 用 div[role="textbox"] 或 .monaco-editor 内的元素
  if (el.closest(".monaco-editor")) return true;
  if (el.closest(".xterm")) return true; // 终端
  return false;
}

// ─── 内部组件（需要访问 ClipboardContext）────────────────────────────────────

const FileTreeInner: React.FC<FileTreeProps> = ({ explorer, onOpenFile, activeFilePath }) => {
  const { rootPath, rootNodes } = explorer;
  const { clipboard, setClipboard, clearClipboard } = useClipboard();
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [createValue, setCreateValue] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null);
  const rootMenuRef = useRef<HTMLDivElement>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [creating]);

  useEffect(() => {
    if (!rootContextMenu) return;
    const handler = (e: MouseEvent) => {
      if (rootMenuRef.current && !rootMenuRef.current.contains(e.target as Node)) {
        setRootContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [rootContextMenu]);

  const handleRefresh = async () => {
    if (!rootPath) return;
    try {
      const nodes = await invoke<FileNode[]>("read_directory", { path: rootPath });
      explorer.setRootNodes(nodes);
    } catch (err) {
      console.error("刷新失败:", err);
    }
  };

  // 监听 Rust 端 write_file_content 发出的 file-system-changed 事件，自动刷新文件树
  useEffect(() => {
    if (!rootPath) return;
    let unlisten: UnlistenFn | null = null;
    listen<string>("file-system-changed", () => {
      void (async () => {
        try {
          const nodes = await invoke<FileNode[]>("read_directory", { path: rootPath });
          explorer.setRootNodes(nodes);
        } catch (err) {
          console.error("file-system-changed 刷新失败:", err);
        }
      })();
    })
      .then((fn) => { unlisten = fn; })
      .catch((err) => console.error("listen file-system-changed 失败:", err));
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  const handleStartCreate = (type: "file" | "dir") => {
    setCreateValue("");
    setCreating(type);
  };

  const handleCreateSubmit = async () => {
    const name = createValue.trim();
    setCreating(null);
    if (!name || !rootPath) return;
    const sep = rootPath.includes("\\") ? "\\" : "/";
    const newPath = rootPath.replace(/[/\\]$/, "") + sep + name;
    try {
      if (creating === "dir") {
        await invoke("create_directory", { path: newPath });
      } else {
        await invoke("create_file", { path: newPath });
      }
      const nodes = await invoke<FileNode[]>("read_directory", { path: rootPath });
      explorer.setRootNodes(nodes);
    } catch (err) {
      alert(`创建失败: ${err}`);
    }
  };

  // 定位当前文件
  const handleRevealActiveFile = useCallback(async () => {
    if (!activeFilePath || !rootPath) return;
    const ancestors = getAncestorPaths(activeFilePath);
    for (const ancestor of ancestors) {
      const matchedPath = findNodePath(rootNodes, ancestor);
      if (matchedPath && !explorer.isExpanded(matchedPath)) {
        explorer.toggleExpand(matchedPath);
        const node = findNode(rootNodes, matchedPath);
        if (node && (!node.children || node.children.length === 0)) {
          try {
            const children = await invoke<FileNode[]>("read_directory", { path: matchedPath });
            explorer.updateChildren(matchedPath, children);
          } catch { /* ignore */ }
        }
      }
    }
    setTimeout(() => {
      if (!scrollContainerRef.current) return;
      const normalizedActive = normPath(activeFilePath);
      const el = scrollContainerRef.current.querySelector(`[data-path="${CSS.escape(normalizedActive)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 100);
  }, [activeFilePath, rootPath, rootNodes, explorer]);

  // ─── 键盘快捷键（仅在文件树区域有焦点时生效）────────────────────────────────

  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    // 如果焦点在编辑器/终端/输入框，不劫持
    if (isFocusInEditor()) return;
    if (!selectedPath) return;

    if (e.ctrlKey && e.key === "c") {
      e.preventDefault();
      const name = normPath(selectedPath).split("/").pop() ?? selectedPath;
      setClipboard({ type: "copy", path: selectedPath, name });
    } else if (e.ctrlKey && e.key === "x") {
      e.preventDefault();
      const name = normPath(selectedPath).split("/").pop() ?? selectedPath;
      setClipboard({ type: "cut", path: selectedPath, name });
    } else if (e.ctrlKey && e.key === "v") {
      if (!clipboard || !rootPath) return;
      e.preventDefault();

      const node = findNode(rootNodes, selectedPath);
      const pasteDir = (node && node.is_dir) ? normPath(selectedPath) : getParentPath(selectedPath);

      // 防止移动到自身子目录
      if (clipboard.type === "cut") {
        const srcNorm = normPath(clipboard.path);
        if (srcNorm === pasteDir || pasteDir.startsWith(srcNorm + "/")) {
          alert("不能将文件夹移动到自身或其子目录中");
          return;
        }
      }

      try {
        if (clipboard.type === "cut") {
          await invoke<string>("move_path_safe", { srcPath: clipboard.path, destDir: pasteDir });
          explorer.removeNode(clipboard.path);
          clearClipboard();
        } else {
          await invoke<string>("copy_path_safe", { srcPath: clipboard.path, destDir: pasteDir });
        }
        // 刷新目标目录
        const children = await invoke<FileNode[]>("read_directory", { path: pasteDir });
        explorer.updateChildren(pasteDir, children);
        // 如果目标是折叠的目录，展开它
        if (node && node.is_dir && !explorer.isExpanded(node.path)) {
          explorer.toggleExpand(node.path);
        }
      } catch (err) {
        alert(`粘贴失败: ${err}`);
      }
    } else if (e.key === "F2") {
      // F2 重命名（由 FileTreeNode 内部处理，这里只做选中节点的触发）
      // 暂不在此处理，由节点右键菜单触发
    } else if (e.key === "Delete") {
      e.preventDefault();
      const name = normPath(selectedPath).split("/").pop() ?? selectedPath;
      const confirmed = await confirm(
        `确定要删除「${name}」吗？此操作不可撤销。`,
        { title: "删除确认", kind: "warning" }
      );
      if (!confirmed) return;
      try {
        await invoke("delete_path", { path: selectedPath });
        explorer.removeNode(selectedPath);
        setSelectedPath(null);
      } catch (err) {
        alert(`删除失败: ${err}`);
      }
    }
  }, [selectedPath, rootPath, rootNodes, explorer, clipboard, setClipboard, clearClipboard]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!rootPath) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: "12px", padding: "0 16px", textAlign: "center", gap: "10px" }}>
        <div style={{ fontSize: "32px", opacity: 0.3 }}>📁</div>
        <p>尚未打开文件夹</p>
        <p style={{ opacity: 0.6 }}>使用「文件 → 打开文件夹」开始</p>
      </div>
    );
  }

  const rootName = rootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? rootPath;

  const iconBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: "#888",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: "3px",
    fontSize: "14px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 标题 + 工具栏 */}
      <div style={{ display: "flex", alignItems: "center", padding: "4px 8px 4px 12px", flexShrink: 0 }}>
        <span style={{ color: "#bbbbbb", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", flex: 1 }}>
          资源管理器
        </span>
        {/* 定位当前文件 */}
        <button
          title="在资源管理器中定位当前文件"
          style={iconBtnStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cccccc"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; }}
          onClick={handleRevealActiveFile}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm0 2a1 1 0 100 2 1 1 0 000-2zm-1 3h2v5H7V7z"/>
          </svg>
        </button>
        {/* 新建文件 */}
        <button
          title="新建文件"
          style={iconBtnStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cccccc"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; }}
          onClick={() => handleStartCreate("file")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V6L9 1zm0 1.5L12.5 6H9V2.5zM11 9H8.5v2.5h-1V9H5V8h2.5V5.5h1V8H11v1z"/>
          </svg>
        </button>
        {/* 新建文件夹 */}
        <button
          title="新建文件夹"
          style={iconBtnStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cccccc"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; }}
          onClick={() => handleStartCreate("dir")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.5 3H7.707l-1.5-1.5H1.5A1.5 1.5 0 000 3v10a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0016 13V4.5A1.5 1.5 0 0014.5 3zM9 9.5H7.5V11h-1V9.5H5v-1h1.5V7h1v1.5H9v1z"/>
          </svg>
        </button>
        {/* 刷新 */}
        <button
          title="刷新"
          style={iconBtnStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#cccccc"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; }}
          onClick={handleRefresh}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335-.43-.719-.822-1.145-1.165a5.22 5.22 0 00-1.5-.877 5.45 5.45 0 00-1.807-.319 5.6 5.6 0 00-2.076.397 5.35 5.35 0 00-1.72 1.116A5.4 5.4 0 002.64 5.95a5.6 5.6 0 00-.394 2.07c0 .72.132 1.41.394 2.07a5.4 5.4 0 001.84 2.222 5.35 5.35 0 001.72 1.116 5.6 5.6 0 002.076.397 5.45 5.45 0 001.807-.319 5.22 5.22 0 001.5-.877 5.3 5.3 0 001.145-1.165l.076.094 1.068.812.579-.939A6.5 6.5 0 018.276 14.5a6.5 6.5 0 01-6.5-6.5 6.5 6.5 0 016.5-6.5 6.5 6.5 0 015.175 2.609zM14.5 1v5h-5l1.688-1.688A5.5 5.5 0 008.276 3a5.5 5.5 0 00-5.5 5.5 5.5 5.5 0 005.5 5.5 5.5 5.5 0 005.175-3.609l.94.579A6.5 6.5 0 018.276 15a6.5 6.5 0 01-6.5-6.5A6.5 6.5 0 018.276 2a6.5 6.5 0 014.536 1.836L14.5 1z"/>
          </svg>
        </button>
      </div>

      {/* 剪贴板状态提示条 */}
      {clipboard && (
        <div style={{
          padding: "3px 12px",
          fontSize: "11px",
          color: "#888",
          backgroundColor: "#1e1e1e",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          flexShrink: 0,
        }}>
          <span style={{ color: clipboard.type === "cut" ? "#e8c07d" : "#4ec9b0" }}>
            {clipboard.type === "cut" ? "✂" : "⧉"}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {clipboard.name}
          </span>
          <button
            onClick={clearClipboard}
            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: "0 2px", fontSize: "12px" }}
            title="清除剪贴板"
          >
            ✕
          </button>
        </div>
      )}

      {/* 根目录名称 */}
      <div style={{ padding: "2px 12px 6px", color: "#cccccc", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, borderBottom: "1px solid #1e1e1e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rootPath}>
        {rootName}
      </div>

      {/* 文件树滚动区域 */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {/* 根目录新建输入框 */}
        {creating && (
          <div style={{ display: "flex", alignItems: "center", height: "22px", paddingLeft: "8px", paddingRight: "8px", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "#888", flexShrink: 0 }}>
              {creating === "dir" ? "📁" : "📄"}
            </span>
            <input
              ref={createInputRef}
              value={createValue}
              onChange={(e) => setCreateValue(e.target.value)}
              onBlur={handleCreateSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateSubmit();
                if (e.key === "Escape") setCreating(null);
              }}
              placeholder={creating === "dir" ? "文件夹名称" : "文件名称"}
              style={{
                flex: 1,
                fontSize: "13px",
                backgroundColor: "#3c3c3c",
                color: "#cccccc",
                border: "1px solid #007acc",
                borderRadius: "2px",
                padding: "1px 4px",
                outline: "none",
              }}
            />
          </div>
        )}

        {rootNodes.length === 0 && !creating ? (
          <div style={{ color: "#666", fontSize: "12px", fontStyle: "italic", padding: "8px 16px" }}>空目录</div>
        ) : (
          rootNodes.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              explorer={explorer}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ─── 导出：包裹 ClipboardProvider ─────────────────────────────────────────────

const FileTree: React.FC<FileTreeProps> = (props) => (
  <ClipboardProvider>
    <FileTreeInner {...props} />
  </ClipboardProvider>
);

export default FileTree;
