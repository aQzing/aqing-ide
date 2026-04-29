import React from "react";

export type ActivityView = "explorer" | "search" | "git" | "extensions";

interface ActivityBarProps {
  activeView: ActivityView | null;
  onSelect: (view: ActivityView) => void;
  onOpenSettings: () => void;
}

interface ActivityItem {
  id: ActivityView;
  title: string;
  icon: React.ReactNode;
}

const ITEMS: ActivityItem[] = [
  {
    id: "explorer",
    title: "资源管理器",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    ),
  },
  {
    id: "search",
    title: "搜索",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: "git",
    title: "源代码管理",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" />
        <line x1="6" y1="9" x2="6" y2="21" />
      </svg>
    ),
  },
  {
    id: "extensions",
    title: "扩展",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="9" height="9" rx="1" />
        <rect x="13" y="2" width="9" height="9" rx="1" />
        <rect x="2" y="13" width="9" height="9" rx="1" />
        <rect x="13" y="13" width="9" height="9" rx="1" />
      </svg>
    ),
  },
];

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onSelect, onOpenSettings }) => {
  return (
    <div
      style={{
        width: "48px",
        flexShrink: 0,
        backgroundColor: "#333333",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "4px",
        borderRight: "1px solid #252526",
        userSelect: "none",
      }}
    >
      {/* 顶部功能图标 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", flex: 1 }}>
        {ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <ActivityIcon
              key={item.id}
              item={item}
              isActive={isActive}
              onClick={() => onSelect(item.id)}
            />
          );
        })}
      </div>

      {/* 底部设置图标 */}
      <div style={{ paddingBottom: "8px" }}>
        <ActivityIcon
          item={{
            id: "extensions" as ActivityView,
            title: "设置",
            icon: (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            ),
          }}
          isActive={false}
          onClick={onOpenSettings}
        />
      </div>
    </div>
  );
};

interface ActivityIconProps {
  item: ActivityItem;
  isActive: boolean;
  onClick: () => void;
}

const ActivityIcon: React.FC<ActivityIconProps> = ({ item, isActive, onClick }) => {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={item.title}
      style={{
        position: "relative",
        width: "48px",
        height: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: isActive ? "#ffffff" : hovered ? "#cccccc" : "#858585",
        transition: "color 0.1s",
      }}
    >
      {/* 左侧激活指示条 */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: "2px",
            height: "24px",
            backgroundColor: "#ffffff",
            borderRadius: "0 2px 2px 0",
          }}
        />
      )}
      {item.icon}
    </div>
  );
};

export default ActivityBar;
