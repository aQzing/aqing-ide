import React from "react";

interface StatusBarProps {
  language: string;
  cursorLine: number;
  cursorColumn: number;
  filePath: string | null;
  modelName?: string;
}

const StatusBar: React.FC<StatusBarProps> = ({
  language,
  cursorLine,
  cursorColumn,
  filePath,
  modelName,
}) => {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "22px", padding: "0 12px", backgroundColor: "#007acc", color: "white", fontSize: "12px", userSelect: "none", flexShrink: 0 }}>
      {/* 左侧：文件路径 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden" }}>
        {filePath && (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.85 }} title={filePath}>
            {filePath}
          </span>
        )}
      </div>

      {/* 右侧：语言 | 光标位置 | 模型 */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }}>
        <span>{language || "Plain Text"}</span>
        <span>行 {cursorLine}，列 {cursorColumn}</span>
        <span style={{ opacity: 0.75 }}>{modelName || "未配置模型"}</span>
      </div>
    </div>
  );
};

export default StatusBar;
