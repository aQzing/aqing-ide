import React, { useState, useRef, useEffect } from "react";
import type { FileTab } from "../../store/editorStore";

interface TabBarProps {
  tabs: FileTab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
  onCloseAll: () => void;
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseLeft,
  onCloseRight,
  onCloseAll,
}) => {
  if (tabs.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", height: "36px", backgroundColor: "#252526", overflowX: "auto", flexShrink: 0, borderBottom: "1px solid #1e1e1e" }}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isDirty = tab.content !== tab.originalContent;
        const idx = tabs.findIndex((t) => t.id === tab.id);

        return (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={isActive}
            isDirty={isDirty}
            hasLeft={idx > 0}
            hasRight={idx < tabs.length - 1}
            hasOthers={tabs.length > 1}
            onActivate={onActivate}
            onClose={onClose}
            onCloseOthers={onCloseOthers}
            onCloseLeft={onCloseLeft}
            onCloseRight={onCloseRight}
            onCloseAll={onCloseAll}
          />
        );
      })}
    </div>
  );
};

interface TabItemProps {
  tab: FileTab;
  isActive: boolean;
  isDirty: boolean;
  hasLeft: boolean;
  hasRight: boolean;
  hasOthers: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
  onCloseAll: () => void;
}

const TabItem: React.FC<TabItemProps> = ({
  tab, isActive, isDirty, hasLeft, hasRight, hasOthers,
  onActivate, onClose, onCloseOthers, onCloseLeft, onCloseRight, onCloseAll,
}) => {
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "0 12px",
          height: "100%",
          minWidth: 0,
          maxWidth: "160px",
          cursor: "pointer",
          flexShrink: 0,
          borderRight: "1px solid #1e1e1e",
          borderTop: isActive ? "2px solid #007acc" : "2px solid transparent",
          backgroundColor: isActive ? "#1e1e1e" : hovered ? "#1e1e1e" : "#2d2d2d",
          color: isActive ? "#ffffff" : hovered ? "#cccccc" : "#969696",
          transition: "background-color 0.1s, color 0.1s",
        }}
        onClick={() => onActivate(tab.id)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tab.path}
      >
        {isDirty && (
          <span style={{ color: "#e8a838", fontSize: "12px", flexShrink: 0 }}>●</span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px" }}>
          {tab.name}
        </span>
        <button
          style={{
            flexShrink: 0,
            width: "16px",
            height: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "3px",
            fontSize: "14px",
            lineHeight: 1,
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            opacity: isActive || hovered ? 0.7 : 0,
            transition: "opacity 0.1s, background-color 0.1s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3c3c3c"; (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          title="关闭"
        >
          ×
        </button>
      </div>

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
            minWidth: "180px",
          }}
        >
          <TabMenuItem label="关闭" onClick={() => { onClose(tab.id); setContextMenu(null); }} />
          <TabMenuItem label="关闭其它" disabled={!hasOthers} onClick={() => { onCloseOthers(tab.id); setContextMenu(null); }} />
          <TabMenuItem label="关闭左侧所有" disabled={!hasLeft} onClick={() => { onCloseLeft(tab.id); setContextMenu(null); }} />
          <TabMenuItem label="关闭右侧所有" disabled={!hasRight} onClick={() => { onCloseRight(tab.id); setContextMenu(null); }} />
          <div style={{ margin: "4px 0", borderTop: "1px solid #454545" }} />
          <TabMenuItem label="关闭所有" onClick={() => { onCloseAll(); setContextMenu(null); }} />
        </div>
      )}
    </>
  );
};

const TabMenuItem: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({ label, onClick, disabled }) => (
  <button
    disabled={disabled}
    style={{
      width: "100%",
      textAlign: "left",
      padding: "6px 16px",
      fontSize: "13px",
      color: disabled ? "#555" : "#cccccc",
      background: "transparent",
      border: "none",
      cursor: disabled ? "default" : "pointer",
      display: "block",
    }}
    onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#094771"; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    onClick={disabled ? undefined : onClick}
  >
    {label}
  </button>
);

export default TabBar;
