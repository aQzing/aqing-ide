import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ask } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Store } from "@tauri-apps/plugin-store";
import MenuBar from "./MenuBar";
import ActivityBar, { type ActivityView } from "./ActivityBar";
import Sidebar from "./Sidebar";
import EditorArea from "./EditorArea";
import ChatPanel from "./ChatPanel";
import StatusBar from "./StatusBar";
import ResizableDivider from "./ResizableDivider";
import SettingsModal from "./SettingsModal";
import SearchPanel from "../explorer/SearchPanel";
import TerminalPanel from "../terminal/TerminalPanel";
import { useEditorStore } from "../../store/editorStore";
import { useExplorerStore } from "../../store/explorerStore";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import type { FileNode } from "../../store/explorerStore";
import type { PendingChatCommand } from "../../store/editorStore";

// 持久化 store 键名
const STORE_KEY = "workspace";
const WORKSPACE_PATH_KEY = "lastWorkspacePath";

const AppLayout: React.FC = () => {
  const editor = useEditorStore();
  const explorer = useExplorerStore();
  const aiSettings = useAiSettingsStore();
  const [chatVisible, setChatVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [storeInstance, setStoreInstance] = useState<Store | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [chatWidth, setChatWidth] = useState(300);
  const [activeView, setActiveView] = useState<ActivityView | null>("explorer");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // AI 右键菜单触发的待处理命令，传递给 ChatPanel
  const [pendingChatCommand, setPendingChatCommand] = useState<PendingChatCommand | null>(null);

  // 收到 AI 命令时自动展开 Chat 面板
  const handleAiCommand = useCallback((cmd: PendingChatCommand) => {
    setChatVisible(true);
    setPendingChatCommand(cmd);
  }, []);

  // ── 文件系统变更监听：自动同步编辑器内容 ──────────────────────────────────
  // 使用 ref 持有最新的 editor，避免闭包过期
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // 记录当前正在由 IDE 自身保存的文件路径（规范化为正斜杠）。
  // 保存操作会触发 Rust 端 emit file-system-changed，必须跳过这些事件，
  // 避免"自己保存 → 触发重载 → 覆盖编辑器内容"的竞态问题。
  const savingPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<string>("file-system-changed", (event) => {
        const changedPath = event.payload;
        if (!changedPath) return;

        // 路径规范化（统一正斜杠）
        const normalizedChanged = changedPath.replace(/\\/g, "/");

        // 如果是 IDE 自身触发的保存，直接忽略，不重载内容
        if (savingPathsRef.current.has(normalizedChanged)) {
          return;
        }

        const currentEditor = editorRef.current;
        const tab = currentEditor.findTabByPath(changedPath);
        if (!tab) return; // 文件未在编辑器中打开，忽略

        const hasDirtyChanges = tab.content !== tab.originalContent;

        const doReload = async () => {
          try {
            const newContent = await invoke<string>("read_file_content", { path: tab.path });
            currentEditor.forceUpdateContent(tab.id, newContent);
          } catch (err) {
            console.warn("自动同步文件内容失败:", err);
          }
        };

        if (hasDirtyChanges) {
          // 文件有未保存的本地修改，弹出确认框
          void ask(
            `文件「${tab.name}」已在外部被修改，是否用磁盘上的最新内容覆盖当前编辑内容？\n\n（取消则保留你的本地修改）`,
            { title: "文件已变更", kind: "warning" }
          ).then((confirmed) => {
            if (confirmed) void doReload();
          });
        } else {
          // 无未保存修改，静默刷新（仅处理外部程序修改的情况）
          void doReload();
        }
      });
    };

    void setup();

    return () => {
      if (unlisten) unlisten();
    };
  // 仅在挂载时注册一次监听器；editor 通过 ref 实时获取，无需加入依赖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始化 tauri-plugin-store，恢复上次工作区
  useEffect(() => {
    const initStore = async () => {
      try {
        const store = await Store.load(STORE_KEY);
        setStoreInstance(store);
        const lastPath = await store.get<string>(WORKSPACE_PATH_KEY);
        if (lastPath) {
          await loadWorkspace(lastPath);
        }
      } catch (err) {
        console.error("Store 初始化失败:", err);
      }
    };
    initStore();
  }, []);

  // 加载工作区目录
  const loadWorkspace = useCallback(async (path: string) => {
    try {
      const nodes = await invoke<FileNode[]>("read_directory", { path });
      explorer.setRootPath(path);
      explorer.setRootNodes(nodes);
    } catch (err) {
      console.error("加载工作区失败:", err);
      alert(`加载工作区失败: ${err}`);
    }
  }, [explorer]);

  // 打开文件夹对话框
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择工作区文件夹",
      });
      if (!selected || typeof selected !== "string") return;

      await loadWorkspace(selected);

      // 持久化工作区路径
      if (storeInstance) {
        await storeInstance.set(WORKSPACE_PATH_KEY, selected);
        await storeInstance.save();
      }
    } catch (err) {
      console.error("打开文件夹失败:", err);
    }
  }, [loadWorkspace, storeInstance]);

  // 打开文件（从文件树或搜索结果点击）
  const handleOpenFile = useCallback(async (
    path: string,
    name: string,
    line?: number,
    matchStart?: number,
    matchEnd?: number
  ) => {
    const existing = editor.tabs.find((t) => t.id === path);
    if (existing) {
      editor.setActiveTab(path);
      if (line !== undefined) {
        // 文件已打开，直接导航
        setTimeout(() => editor.navigateTo(path, line, matchStart, matchEnd), 50);
      }
      return;
    }
    try {
      const content = await invoke<string>("read_file_content", { path });
      editor.openFile(path, name, content);
      if (line !== undefined) {
        // 文件刚打开，等待 EditorPane 挂载后再导航
        setTimeout(() => editor.navigateTo(path, line, matchStart, matchEnd), 100);
      }
    } catch (err) {
      console.error("读取文件失败:", err);
      alert(`读取文件失败: ${err}`);
    }
  }, [editor]);

  // 保存单个文件（核心实现，接受 tab id）
  const handleSave = useCallback(async (id: string) => {
    const tab = editor.tabs.find((t) => t.id === id);
    if (!tab) return;

    // 规范化路径，与 file-system-changed 事件 payload 保持一致
    const normalizedPath = tab.path.replace(/\\/g, "/");

    try {
      // 在写入前将路径注册到"正在保存"集合，使 file-system-changed 监听器
      // 能够识别并跳过由本次保存触发的事件，避免竞态重载覆盖编辑器内容。
      savingPathsRef.current.add(normalizedPath);

      // 快照当前内容，防止 await 期间用户继续编辑导致内容不一致
      const contentToSave = tab.content;

      await invoke("write_file_content", {
        path: tab.path,
        content: contentToSave,
      });

      // 写入成功后标记为已保存（originalContent 对齐到刚写入的内容）
      editor.markSaved(id);
    } catch (err) {
      console.error("保存文件失败:", err);
      alert(`保存文件失败: ${err}`);
    } finally {
      // 无论成功或失败，都在下一个宏任务中移除保存标记。
      // 使用 setTimeout(0) 确保在 Tauri 事件循环将 file-system-changed
      // 派发到前端之后再解除屏蔽，彻底消除竞态窗口。
      setTimeout(() => {
        savingPathsRef.current.delete(normalizedPath);
      }, 500);
    }
  }, [editor]);

  // 保存当前激活的 Tab（供菜单"保存"项和快捷键 Ctrl+S 调用）
  const handleSaveActive = useCallback(async () => {
    const activeId = editorRef.current.activeTabId;
    if (activeId) {
      await handleSave(activeId);
    }
  }, [handleSave]);

  // 全部保存：保存所有有未保存修改的 Tab（供菜单"全部保存"项和快捷键 Ctrl+Shift+S 调用）
  const handleSaveAll = useCallback(async () => {
    const dirtyTabs = editorRef.current.tabs.filter(
      (t) => t.content !== t.originalContent
    );
    await Promise.all(dirtyTabs.map((t) => handleSave(t.id)));
  }, [handleSave]);

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        handleOpenFolder();
      }
      // Ctrl+Shift+S 全部保存（需先于 Ctrl+S 判断，否则 shiftKey 分支被跳过）
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        void handleSaveAll();
      } else if (e.ctrlKey && !e.shiftKey && e.key === "s") {
        // Ctrl+S 保存当前激活文件
        e.preventDefault();
        void handleSaveActive();
      }
      // Ctrl+` 切换 Chat 面板
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setChatVisible((v) => !v);
      }
      // Ctrl+J 切换终端面板
      if (e.ctrlKey && e.key === "j") {
        e.preventDefault();
        setTerminalVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenFolder, handleSaveActive, handleSaveAll]);

  // 当前激活 Tab 信息（用于状态栏）
  const activeTab = editor.tabs.find((t) => t.id === editor.activeTabId);

  const handleSidebarDrag = useCallback((delta: number) => {
    setSidebarWidth((prev) => Math.max(150, Math.min(500, prev + delta)));
  }, []);

  const handleChatDrag = useCallback((delta: number) => {
    setChatWidth((prev) => Math.max(200, Math.min(600, prev - delta)));
  }, []);

  // 点击活动栏图标：同一图标再次点击则折叠侧边栏
  const handleActivitySelect = useCallback((view: ActivityView) => {
    setActiveView((prev) => (prev === view ? null : view));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "hidden", backgroundColor: "#1e1e1e" }}>
      {/* 顶部菜单栏 */}
      <MenuBar onOpenFolder={handleOpenFolder} onSave={handleSaveActive} onSaveAll={handleSaveAll} />

      {/* 主体区域 */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* 最左侧活动栏 */}
        <ActivityBar activeView={activeView} onSelect={handleActivitySelect} onOpenSettings={() => setSettingsOpen(true)} />

        {/* 侧边栏（可折叠） */}
        {activeView !== null && (
          <>
            <div style={{ width: sidebarWidth, flexShrink: 0, overflow: "hidden", backgroundColor: "#252526", borderRight: "1px solid #1e1e1e" }}>
              {activeView === "explorer" && (
                <Sidebar explorer={explorer} onOpenFile={handleOpenFile} activeFilePath={activeTab?.path ?? null} />
              )}
              {activeView === "search" && (
                <SearchPanel explorer={explorer} onOpenFile={handleOpenFile} />
              )}
              {activeView === "git" && (
                <PlaceholderPanel title="源代码管理" message="Git 功能即将上线" />
              )}
              {activeView === "extensions" && (
                <PlaceholderPanel title="扩展" message="扩展市场即将上线" />
              )}
            </div>
            <ResizableDivider onDrag={handleSidebarDrag} />
          </>
        )}

        {/* 中间编辑区 + 终端面板（垂直布局） */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <EditorArea editor={editor} onSave={handleSave} aiSettings={aiSettings} onAiCommand={handleAiCommand} />
          </div>
          {/* 底部终端面板 */}
          <TerminalPanel
            defaultCwd={explorer.rootPath ?? "."}
            visible={terminalVisible}
            onToggle={() => setTerminalVisible((v) => !v)}
          />
        </div>

        {/* 右侧 AI Chat 面板 */}
        {chatVisible && (
          <>
            <ResizableDivider onDrag={handleChatDrag} />
            <div style={{ width: chatWidth, flexShrink: 0, overflow: "hidden" }}>
              <ChatPanel
                aiSettings={aiSettings}
                activeTab={activeTab ?? null}
                workspacePath={explorer.rootPath ?? null}
                pendingChatCommand={pendingChatCommand}
                onClearPendingCommand={() => setPendingChatCommand(null)}
              />
            </div>
          </>
        )}
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        language={activeTab?.language ?? ""}
        cursorLine={activeTab?.cursorLine ?? 1}
        cursorColumn={activeTab?.cursorColumn ?? 1}
        filePath={activeTab?.path ?? null}
        modelName={aiSettings.getActiveChatModelName()}
      />

      {/* AI 设置模态框 */}
      {settingsOpen && (
        <SettingsModal aiSettings={aiSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
};

// 占位面板（Git / 扩展等未实现功能）
const PlaceholderPanel: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
    <div style={{ padding: "6px 12px", color: "#bbbbbb", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
      {title}
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: "#666", fontSize: "12px", textAlign: "center", padding: "0 16px", gap: "8px" }}>
      <p>{message}</p>
    </div>
  </div>
);

export default AppLayout;
