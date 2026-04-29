import React from "react";
import FileTree from "../explorer/FileTree";
import type { ExplorerState } from "../../store/explorerStore";

interface SidebarProps {
  explorer: ExplorerState;
  onOpenFile: (path: string, name: string) => void;
  activeFilePath: string | null;
}

const Sidebar: React.FC<SidebarProps> = ({ explorer, onOpenFile, activeFilePath }) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#252526", borderRight: "1px solid #1e1e1e", overflow: "hidden" }}>
      <FileTree explorer={explorer} onOpenFile={onOpenFile} activeFilePath={activeFilePath} />
    </div>
  );
};

export default Sidebar;

