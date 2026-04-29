import React, { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { FileNode } from "../../store/explorerStore";
import type { ExplorerState } from "../../store/explorerStore";
import { useClipboard } from "./ClipboardContext";

// ─── 图标 ─────────────────────────────────────────────────────────────────────

const FolderIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    {open ? (
      <path d="M1.5 3.5h4l1.5 1.5H14.5v8H1.5V3.5z" fill="#e8c07d" opacity="0.9" />
    ) : (
      <path d="M1.5 3.5h4l1.5 1.5H14.5v7.5H1.5V3.5z" fill="#e8c07d" opacity="0.75" />
    )}
  </svg>
);

function getFileIconInfo(name: string): { label: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, { label: string; color: string }> = {
    ts:   { label: "TS",   color: "#3178c6" },
    tsx:  { label: "TSX",  color: "#3178c6" },
    js:   { label: "JS",   color: "#f7df1e" },
    jsx:  { label: "JSX",  color: "#61dafb" },
    rs:   { label: "RS",   color: "#ce422b" },
    py:   { label: "PY",   color: "#3572a5" },
    json: { label: "{}",   color: "#cbcb41" },
    css:  { label: "CSS",  color: "#563d7c" },
    scss: { label: "SCSS", color: "#c6538c" },
    html: { label: "HTML", color: "#e34c26" },
    md:   { label: "MD",   color: "#083fa1" },
    toml: { label: "TM",   color: "#9c4221" },
    yaml: { label: "YML",  color: "#cb171e" },
    yml:  { label: "YML",  color: "#cb171e" },
    sh:   { label: "SH",   color: "#89e051" },
    txt:  { label: "TXT",  color: "#888" },
    svg:  { label: "SVG",  color: "#ffb13b" },
    png:  { label: "IMG",  color: "#a074c4" },
    jpg:  { label: "IMG",  color: "#a074c4" },
    gif:  { label: "IMG",  color: "#a074c4" },
  };
  return map[ext] ?? { label: "·", color: "#888" };
}

function normPath(p: string) {
  return p.replace(/\\/g, "/");
}

function getParentPath(filePath: string): string {
  const normalized = normPath(filePath);
  return normalized.split("/").slice(0, -1).join("/");
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  explorer: ExplorerState;
  onOpenFile: (path: string, name: string) => void;
  activeFilePath: string | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────────

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  depth,
  explorer,
  onOpenFile,
  activeFilePath,
  selectedPath,
  onSelect,
}) => {
  const { clipboard, setClipboard, clearClipboard } = useClipboard();
  const expanded = explorer.isExpanded(node.path);
  const isActive = activeFilePath ? normPath(node.path) === normPath(activeFilePath) : false;
  const isSelected = selectedPath ? normPath(node.path) === normPath(selectedPath) : false;
  // 剪切状态：被剪切的文件显示半透明
  const isCut = clipboard?.type === "cut" && normPath(clipboard.path) === normPath(node.path);

  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [createValue, setCreateValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      const dotIdx = node.name.lastIndexOf(".");
      renameInputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.name.length);
    }
  }, [renaming]);

  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [creating]);

  // ─── 事件处理 ───────────────────────────────────────────────────────────────

  const handleClick = async () => {
    if (renaming || creating) return;
    onSelect(node.path);
    if (node.is_dir) {
      explorer.toggleExpand(node.path);
      if (!expanded && (!node.children || node.children.length === 0)) {
        try {
          const children = await invoke<FileNode[]>("read_directory", { path: node.path });
          explorer.updateChildren(node.path, children);
        } catch (err) {
          console.error("加载子目录失败:", err);
        }
      }
    } else {
      onOpenFile(node.path, node.name);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(node.path);
    setContextMenu(null);
  };

  const handleCopyRelativePath = () => {
    const root = normPath(explorer.rootPath ?? "");
    const full = normPath(node.path);
    const rel = full.startsWith(root) ? full.slice(root.length).replace(/^\//, "") : full;
    navigator.clipboard.writeText(rel);
    setContextMenu(null);
  };

  const handleCut = () => {
    setClipboard({ type: "cut", path: node.path, name: node.name });
    setContextMenu(null);
  };

  const handleCopy = () => {
    setClipboard({ type: "copy", path: node.path, name: node.name });
    setContextMenu(null);
  };

  const handlePaste = async () => {
    setContextMenu(null);
    if (!clipboard) return;

    // 确定粘贴目标目录
    const targetDir = node.is_dir ? normPath(node.path) : getParentPath(node.path);

    // 不能粘贴到自身或自身的子目录（剪切时）
    if (clipboard.type === "cut") {
      const srcNorm = normPath(clipboard.path);
      if (srcNorm === targetDir || targetDir.startsWith(srcNorm + "/")) {
        alert("不能将文件夹移动到自身或其子目录中");
        return;
      }
    }

    try {
      if (clipboard.type === "cut") {
        // 移动：使用 move_path_safe 自动处理冲突
        const actualDest = await invoke<string>("move_path_safe", {
          srcPath: clipboard.path,
          destDir: targetDir,
        });
        explorer.removeNode(clipboard.path);
        clearClipboard();
        // 刷新目标目录
        await refreshDir(targetDir, node, explorer);
        console.log("移动完成:", actualDest);
      } else {
        // 复制：使用 copy_path_safe 自动处理冲突
        const actualDest = await invoke<string>("copy_path_safe", {
          srcPath: clipboard.path,
          destDir: targetDir,
        });
        // 刷新目标目录
        await refreshDir(targetDir, node, explorer);
        console.log("复制完成:", actualDest);
      }
    } catch (err) {
      alert(`粘贴失败: ${err}`);
    }
  };

  const handleStartRename = () => {
    setRenameValue(node.name);
    setRenaming(true);
    setContextMenu(null);
  };

  const handleRenameSubmit = async () => {
    const newName = renameValue.trim();
    setRenaming(false);
    if (!newName || newName === node.name) return;
    const parentPath = getParentPath(node.path);
    const sep = node.path.includes("\\") ? "\\" : "/";
    const newPath = parentPath + sep + newName;
    try {
      await invoke("rename_path", { oldPath: node.path, newPath });
      explorer.renameNode(node.path, newPath, newName);
    } catch (err) {
      alert(`重命名失败: ${err}`);
    }
  };

  const handleDelete = async () => {
    setContextMenu(null);
    const confirmed = await confirm(
      `确定要删除「${node.name}」吗？此操作不可撤销。`,
      { title: "删除确认", kind: "warning" }
    );
    if (!confirmed) return;
    try {
      await invoke("delete_path", { path: node.path });
      explorer.removeNode(node.path);
    } catch (err) {
      alert(`删除失败: ${err}`);
    }
  };

  const handleStartCreate = (type: "file" | "dir") => {
    setContextMenu(null);
    if (!node.is_dir) return;
    if (!expanded) explorer.toggleExpand(node.path);
    setCreateValue("");
    setCreating(type);
  };

  const handleCreateSubmit = async () => {
    const name = createValue.trim();
    setCreating(null);
    if (!name) return;
    const sep = node.path.includes("\\") ? "\\" : "/";
    const newPath = node.path + sep + name;
    try {
      if (creating === "dir") {
        await invoke("create_directory", { path: newPath });
      } else {
        await invoke("create_file", { path: newPath });
      }
      const children = await invoke<FileNode[]>("read_directory", { path: node.path });
      explorer.updateChildren(node.path, children);
    } catch (err) {
      alert(`创建失败: ${err}`);
    }
  };

  const handleRevealInExplorer = async () => {
    setContextMenu(null);
    try {
      await invoke("reveal_in_explorer", { path: node.path });
    } catch (err) {
      console.warn("在文件管理器中显示失败:", err);
    }
  };

  // ─── 渲染 ────────────────────────────────────────────────────────────────────

  const paddingLeft = depth * 12 + 8;
  const normalizedPath = normPath(node.path);

  return (
    <div>
      {/* 节点行 */}
      <div
        data-path={normalizedPath}
        style={{
          display: "flex",
          alignItems: "center",
          height: "22px",
          paddingLeft,
          paddingRight: "8px",
          cursor: "pointer",
          backgroundColor: isActive ? "#094771" : isSelected ? "#37373d" : hovered ? "#2a2d2e" : "transparent",
          userSelect: "none",
          transition: "background-color 0.1s",
          gap: "4px",
          // 剪切状态半透明
          opacity: isCut ? 0.5 : 1,
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={node.path}
      >
        {/* 展开箭头（仅目录） */}
        {node.is_dir ? (
          <span style={{
            fontSize: "10px",
            color: "#888",
            display: "inline-block",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            flexShrink: 0,
            width: "12px",
            textAlign: "center",
          }}>▶</span>
        ) : (
          <span style={{ width: "12px", flexShrink: 0 }} />
        )}

        {/* 图标 */}
        {node.is_dir ? (
          <FolderIcon open={expanded} />
        ) : (
          <span style={{
            fontSize: "10px",
            fontFamily: "monospace",
            flexShrink: 0,
            minWidth: "20px",
            textAlign: "center",
            color: getFileIconInfo(node.name).color,
            fontWeight: 600,
          }}>
            {getFileIconInfo(node.name).label}
          </span>
        )}

        {/* 文件名 / 重命名输入框 */}
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
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
        ) : (
          <span style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "13px",
            color: isActive ? "#ffffff" : "#cccccc",
            flex: 1,
          }}>
            {node.name}
          </span>
        )}
      </div>

      {/* 子节点 */}
      {node.is_dir && expanded && (
        <div>
          {creating && (
            <div style={{
              display: "flex",
              alignItems: "center",
              height: "22px",
              paddingLeft: paddingLeft + 28,
              paddingRight: "8px",
              gap: "4px",
            }}>
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

          {node.children && node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              explorer={explorer}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
          {node.children && node.children.length === 0 && !creating && (
            <div style={{ color: "#666", fontSize: "12px", fontStyle: "italic", paddingLeft: paddingLeft + 28, paddingTop: "2px", paddingBottom: "2px" }}>
              空目录
            </div>
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: "#252526",
            border: "1px solid #454545",
            borderRadius: "4px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            zIndex: 1000,
            padding: "4px 0",
            minWidth: "200px",
          }}
        >
          {/* 文件名标题 */}
          <div style={{ padding: "4px 16px 6px", fontSize: "12px", color: "#888", borderBottom: "1px solid #454545", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.name}
          </div>

          {node.is_dir && (
            <>
              <ContextMenuItem icon="📄" label="新建文件" onClick={() => handleStartCreate("file")} />
              <ContextMenuItem icon="📁" label="新建文件夹" onClick={() => handleStartCreate("dir")} />
              <MenuDivider />
            </>
          )}

          <ContextMenuItem icon="✂" label="剪切" shortcut="Ctrl+X" onClick={handleCut} />
          <ContextMenuItem icon="⧉" label="复制" shortcut="Ctrl+C" onClick={handleCopy} />
          <ContextMenuItem
            icon="📋"
            label={clipboard ? `粘贴「${clipboard.name}」` : "粘贴"}
            shortcut="Ctrl+V"
            disabled={!clipboard}
            onClick={handlePaste}
          />

          <MenuDivider />
          <ContextMenuItem icon="🔗" label="复制路径" onClick={handleCopyPath} />
          <ContextMenuItem icon="🔗" label="复制相对路径" onClick={handleCopyRelativePath} />

          <MenuDivider />
          <ContextMenuItem icon="✏" label="重命名" shortcut="F2" onClick={handleStartRename} />
          <ContextMenuItem icon="📂" label="在文件管理器中显示" onClick={handleRevealInExplorer} />

          <MenuDivider />
          <ContextMenuItem icon="🗑" label="删除" shortcut="Del" onClick={handleDelete} danger />
        </div>
      )}
    </div>
  );
};

// ─── 辅助：刷新目录 ───────────────────────────────────────────────────────────

async function refreshDir(
  dirPath: string,
  node: FileNode,
  explorer: ExplorerState
): Promise<void> {
  try {
    const children = await invoke<FileNode[]>("read_directory", { path: dirPath });
    if (node.is_dir && normPath(node.path) === normPath(dirPath)) {
      explorer.updateChildren(node.path, children);
      if (!explorer.isExpanded(node.path)) {
        explorer.toggleExpand(node.path);
      }
    } else {
      // 找到对应目录节点并更新
      explorer.updateChildren(dirPath, children);
    }
  } catch (err) {
    console.error("刷新目录失败:", err);
  }
}

// ─── 菜单子组件 ───────────────────────────────────────────────────────────────

const MenuDivider = () => (
  <div style={{ margin: "4px 0", borderTop: "1px solid #454545" }} />
);

const ContextMenuItem: React.FC<{
  icon?: string;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}> = ({ icon, label, shortcut, onClick, danger, disabled }) => (
  <button
    style={{
      width: "100%",
      textAlign: "left",
      padding: "6px 16px",
      fontSize: "13px",
      color: disabled ? "#555" : danger ? "#f48771" : "#cccccc",
      background: "transparent",
      border: "none",
      cursor: disabled ? "default" : "pointer",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    }}
    onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#094771"; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    onClick={disabled ? undefined : onClick}
  >
    {icon && <span style={{ fontSize: "12px", width: "16px", textAlign: "center", flexShrink: 0 }}>{icon}</span>}
    <span style={{ flex: 1 }}>{label}</span>
    {shortcut && (
      <span style={{ fontSize: "11px", color: "#666", marginLeft: "auto", flexShrink: 0 }}>{shortcut}</span>
    )}
  </button>
);

export default FileTreeNode;
