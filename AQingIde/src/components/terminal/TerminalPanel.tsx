import React, { useCallback, useEffect, useRef, useState } from "react";
import TerminalTab from "./TerminalTab";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface TerminalInstance {
  id: string;
  title: string;
  cwd: string;
}

interface TerminalPanelProps {
  /** 默认工作目录（通常是当前打开的工作区路径） */
  defaultCwd: string;
  /** 面板是否可见 */
  visible: boolean;
  /** 切换可见性 */
  onToggle: () => void;
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

let terminalCounter = 0;
function createTerminalId(): string {
  terminalCounter += 1;
  return `term-${Date.now()}-${terminalCounter}`;
}

// ─── TerminalPanel 组件 ───────────────────────────────────────────────────────

const MAX_TERMINALS = 5;
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 500;

const TerminalPanel: React.FC<TerminalPanelProps> = ({
  defaultCwd,
  visible,
  onToggle,
}) => {
  const [terminals, setTerminals] = useState<TerminalInstance[]>(() => [
    { id: createTerminalId(), title: "终端 1", cwd: defaultCwd || "." },
  ]);
  const [activeId, setActiveId] = useState<string>(() => terminals[0].id);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);

  // 工作区路径就绪后（异步加载），更新第一个终端的 cwd（仅当它还是默认的 "."）
  useEffect(() => {
    if (!defaultCwd || defaultCwd === ".") return;
    setTerminals((prev) =>
      prev.map((t, i) => (i === 0 && t.cwd === "." ? { ...t, cwd: defaultCwd } : t))
    );
  }, [defaultCwd]);

  // 拖拽调整高度
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(DEFAULT_HEIGHT);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartYRef.current = e.clientY;
      dragStartHeightRef.current = panelHeight;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = dragStartYRef.current - ev.clientY;
        const newHeight = Math.max(
          MIN_HEIGHT,
          Math.min(MAX_HEIGHT, dragStartHeightRef.current + delta)
        );
        setPanelHeight(newHeight);
      };

      const onMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [panelHeight]
  );

  // 新建终端
  const handleNewTerminal = useCallback(() => {
    if (terminals.length >= MAX_TERMINALS) return;
    const id = createTerminalId();
    const title = `终端 ${terminals.length + 1}`;
    const newTerm: TerminalInstance = { id, title, cwd: defaultCwd || "." };
    setTerminals((prev) => [...prev, newTerm]);
    setActiveId(id);
  }, [terminals.length, defaultCwd]);

  // 关闭终端
  const handleCloseTerminal = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (terminals.length === 1) return; // 至少保留一个
      setTerminals((prev) => {
        const next = prev.filter((t) => t.id !== id);
        // 如果关闭的是当前激活的，切换到最后一个
        if (id === activeId) {
          setActiveId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [terminals.length, activeId]
  );

  if (!visible) {
    // 折叠状态：只显示标题栏
    return (
      <div
        style={{
          height: "28px",
          backgroundColor: "#252526",
          borderTop: "1px solid #1e1e1e",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: "8px",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <PanelTitle onToggle={onToggle} expanded={false} />
      </div>
    );
  }

  return (
    <div
      style={{
        height: panelHeight,
        backgroundColor: "#1e1e1e",
        borderTop: "1px solid #1e1e1e",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* 拖拽调整高度的把手 */}
      <div
        onMouseDown={handleDragStart}
        style={{
          height: "4px",
          backgroundColor: "transparent",
          cursor: "ns-resize",
          flexShrink: 0,
          transition: "background-color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#007acc";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent";
        }}
      />

      {/* Tab 栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "#252526",
          borderBottom: "1px solid #1e1e1e",
          height: "30px",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <PanelTitle onToggle={onToggle} expanded={true} />

        {/* 分隔线 */}
        <div style={{ width: "1px", height: "16px", backgroundColor: "#444", margin: "0 4px", flexShrink: 0 }} />

        {/* 终端 Tab 列表 */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", alignItems: "center" }}>
          {terminals.map((t) => (
            <TerminalTabButton
              key={t.id}
              title={t.title}
              isActive={t.id === activeId}
              canClose={terminals.length > 1}
              onClick={() => setActiveId(t.id)}
              onClose={(e) => handleCloseTerminal(t.id, e)}
            />
          ))}
        </div>

        {/* 新建终端按钮 */}
        {terminals.length < MAX_TERMINALS && (
          <button
            onClick={handleNewTerminal}
            title="新建终端"
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              padding: "0 8px",
              fontSize: "16px",
              lineHeight: "30px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#cccccc";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#888";
            }}
          >
            +
          </button>
        )}
      </div>

      {/* 终端内容区 */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {terminals.map((t) => (
          <div
            key={t.id}
            style={{
              position: "absolute",
              inset: 0,
              display: t.id === activeId ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <TerminalTab id={t.id} cwd={t.cwd} isActive={t.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── 子组件 ──────────────────────────────────────────────────────────────────

const PanelTitle: React.FC<{ onToggle: () => void; expanded: boolean }> = ({
  onToggle,
  expanded,
}) => (
  <button
    onClick={onToggle}
    title={expanded ? "折叠终端" : "展开终端"}
    style={{
      background: "none",
      border: "none",
      color: "#cccccc",
      cursor: "pointer",
      padding: "0 8px",
      display: "flex",
      alignItems: "center",
      gap: "5px",
      fontSize: "11px",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      height: "100%",
      flexShrink: 0,
    }}
  >
    <span style={{ fontSize: "10px", color: "#888" }}>{expanded ? "▼" : "▲"}</span>
    终端
  </button>
);

interface TerminalTabButtonProps {
  title: string;
  isActive: boolean;
  canClose: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

const TerminalTabButton: React.FC<TerminalTabButtonProps> = ({
  title,
  isActive,
  canClose,
  onClick,
  onClose,
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 10px",
        height: "30px",
        cursor: "pointer",
        backgroundColor: isActive ? "#1e1e1e" : hovered ? "#2a2d2e" : "transparent",
        borderBottom: isActive ? "1px solid #007acc" : "1px solid transparent",
        color: isActive ? "#cccccc" : "#888",
        fontSize: "12px",
        userSelect: "none",
        flexShrink: 0,
        transition: "background-color 0.1s",
      }}
    >
      {/* 终端图标 */}
      <span style={{ fontSize: "11px", opacity: 0.7 }}>⌨</span>
      <span>{title}</span>
      {canClose && (
        <span
          onClick={onClose}
          title="关闭终端"
          style={{
            marginLeft: "2px",
            color: hovered ? "#cccccc" : "transparent",
            fontSize: "12px",
            lineHeight: 1,
            padding: "1px 2px",
            borderRadius: "2px",
            transition: "color 0.1s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLSpanElement).style.backgroundColor = "#444";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLSpanElement).style.backgroundColor = "transparent";
          }}
        >
          ×
        </span>
      )}
    </div>
  );
};

export default TerminalPanel;
