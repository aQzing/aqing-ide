import React from "react";

interface MenuBarProps {
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAll: () => void;
}

const MenuBar: React.FC<MenuBarProps> = ({ onOpenFolder, onSave, onSaveAll }) => {
  return (
    <div
      style={{ display: "flex", alignItems: "center", height: "36px", padding: "0 8px", backgroundColor: "#3c3c3c", color: "#cccccc", fontSize: "13px", userSelect: "none", flexShrink: 0, borderBottom: "1px solid #252526", gap: "2px" }}
    >
      {/* 应用名称 */}
      <span style={{ fontWeight: 600, color: "#ffffff", marginRight: "12px", padding: "0 6px", fontSize: "13px" }}>
        AQingIDE
      </span>

      {/* 分隔线 */}
      <div style={{ width: "1px", height: "16px", backgroundColor: "#555", marginRight: "4px" }} />

      {/* 菜单项 */}
      <MenuGroup label="文件">
        <MenuItem label="打开文件夹..." shortcut="Ctrl+O" onClick={onOpenFolder} />
        <MenuDivider />
        <MenuItem label="保存" shortcut="Ctrl+S" onClick={onSave} />
        <MenuItem label="全部保存" shortcut="Ctrl+Shift+S" onClick={onSaveAll} />
      </MenuGroup>

      <MenuGroup label="编辑">
        <MenuItem label="撤销" shortcut="Ctrl+Z" onClick={() => {}} />
        <MenuItem label="重做" shortcut="Ctrl+Y" onClick={() => {}} />
        <MenuDivider />
        <MenuItem label="查找" shortcut="Ctrl+F" onClick={() => {}} />
        <MenuItem label="替换" shortcut="Ctrl+H" onClick={() => {}} />
      </MenuGroup>

      <MenuGroup label="视图">
        <MenuItem label="命令面板" shortcut="Ctrl+Shift+P" onClick={() => {}} />
        <MenuItem label="切换终端" shortcut="Ctrl+`" onClick={() => {}} />
      </MenuGroup>
    </div>
  );
};

// 下拉菜单组
interface MenuGroupProps {
  label: string;
  children: React.ReactNode;
}

const MenuGroup: React.FC<MenuGroupProps> = ({ label, children }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        style={{
          padding: "4px 10px",
          borderRadius: "4px",
          background: open ? "#505050" : "transparent",
          color: "#cccccc",
          border: "none",
          cursor: "pointer",
          fontSize: "13px",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = "#505050"; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "2px",
            minWidth: "200px",
            backgroundColor: "#252526",
            border: "1px solid #454545",
            borderRadius: "4px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            zIndex: 50,
            padding: "4px 0",
          }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
};

// 菜单项
interface MenuItemProps {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ label, shortcut, onClick, disabled }) => (
  <button
    style={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 16px",
      textAlign: "left",
      background: "transparent",
      border: "none",
      color: disabled ? "#666" : "#cccccc",
      cursor: disabled ? "not-allowed" : "pointer",
      fontSize: "13px",
      transition: "background 0.1s",
    }}
    onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#094771"; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
  >
    <span>{label}</span>
    {shortcut && (
      <span style={{ marginLeft: "32px", color: "#888", fontSize: "12px" }}>{shortcut}</span>
    )}
  </button>
);

const MenuDivider: React.FC = () => (
  <div style={{ margin: "4px 0", borderTop: "1px solid #454545" }} />
);

export default MenuBar;
