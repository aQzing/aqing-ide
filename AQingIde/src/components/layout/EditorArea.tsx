import React from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import TabBar from "../editor/TabBar";
import EditorPane from "../editor/EditorPane";
import type { EditorState, PendingChatCommand } from "../../store/editorStore";
import type { AiSettingsState } from "../../store/aiSettingsStore";

interface EditorAreaProps {
  editor: EditorState;
  onSave: (id: string) => void;
  aiSettings: AiSettingsState;
  onAiCommand?: (cmd: PendingChatCommand) => void;
}

const EditorArea: React.FC<EditorAreaProps> = ({ editor, onSave, aiSettings, onAiCommand }) => {
  const {
    tabs, activeTabId, setActiveTab, closeTab,
    updateContent, updateCursor, pendingNavigation, clearNavigation,
  } = editor;
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleCloseTab = async (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab && tab.content !== tab.originalContent) {
      const confirmed = await ask(
        `文件「${tab.name}」有未保存的修改，确定要关闭吗？`,
        { title: "未保存的修改", kind: "warning" }
      );
      if (!confirmed) return;
    }
    closeTab(id);
  };

  // 批量关闭时，只对有未保存修改的文件逐一确认
  const handleCloseMultiple = async (ids: string[]) => {
    for (const id of ids) {
      const tab = tabs.find((t) => t.id === id);
      if (tab && tab.content !== tab.originalContent) {
        const confirmed = await ask(
          `文件「${tab.name}」有未保存的修改，确定要关闭吗？`,
          { title: "未保存的修改", kind: "warning" }
        );
        if (!confirmed) continue;
      }
      closeTab(id);
    }
  };

  const handleCloseOthers = async (id: string) => {
    const others = tabs.filter((t) => t.id !== id).map((t) => t.id);
    await handleCloseMultiple(others);
  };

  const handleCloseLeft = async (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const left = tabs.slice(0, idx).map((t) => t.id);
    await handleCloseMultiple(left);
  };

  const handleCloseRight = async (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const right = tabs.slice(idx + 1).map((t) => t.id);
    await handleCloseMultiple(right);
  };

  const handleCloseAll = async () => {
    const all = tabs.map((t) => t.id);
    await handleCloseMultiple(all);
  };

  const activeNavigation =
    pendingNavigation && activeTab && pendingNavigation.tabId === activeTab.id
      ? { line: pendingNavigation.line, matchStart: pendingNavigation.matchStart, matchEnd: pendingNavigation.matchEnd }
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#1e1e1e", overflow: "hidden" }}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={setActiveTab}
        onClose={handleCloseTab}
        onCloseOthers={handleCloseOthers}
        onCloseLeft={handleCloseLeft}
        onCloseRight={handleCloseRight}
        onCloseAll={handleCloseAll}
      />

      {activeTab ? (
        <EditorPane
          key={activeTab.id}
          tab={activeTab}
          onContentChange={updateContent}
          onCursorChange={updateCursor}
          onSave={onSave}
          aiSettings={aiSettings}
          pendingNavigation={activeNavigation}
          onNavigationComplete={clearNavigation}
          onAiCommand={onAiCommand}
        />
      ) : (
        <WelcomeScreen />
      )}
    </div>
  );
};

const WelcomeScreen: React.FC = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: "#888", userSelect: "none", gap: "16px" }}>
    <div style={{ fontSize: "64px", opacity: 0.15 }}>⌨</div>
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: "18px", fontWeight: 600, color: "#cccccc", marginBottom: "8px" }}>AQingIDE</p>
      <p style={{ fontSize: "13px" }}>打开文件夹，点击文件开始编辑</p>
      <p style={{ fontSize: "12px", marginTop: "4px", opacity: 0.6 }}>Ctrl+O 打开文件夹</p>
    </div>
  </div>
);

export default EditorArea;

