import { useState, useCallback } from "react";

// 文件树节点（与 Rust 端 FileNode 对应）
export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface ExplorerState {
  rootPath: string | null;
  rootNodes: FileNode[];
  expandedPaths: Set<string>;
  setRootPath: (path: string) => void;
  setRootNodes: (nodes: FileNode[]) => void;
  toggleExpand: (path: string) => void;
  isExpanded: (path: string) => boolean;
  updateChildren: (path: string, children: FileNode[]) => void;
  removeNode: (path: string) => void;
  renameNode: (oldPath: string, newPath: string, newName: string) => void;
}

export function useExplorerStore(): ExplorerState {
  const [rootPath, setRootPathState] = useState<string | null>(null);
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const setRootPath = useCallback((path: string) => {
    setRootPathState(path);
    setExpandedPaths(new Set());
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback(
    (path: string) => expandedPaths.has(path),
    [expandedPaths]
  );

  const updateChildren = useCallback((targetPath: string, children: FileNode[]) => {
    function updateNode(nodes: FileNode[]): FileNode[] {
      return nodes.map((node) => {
        if (node.path === targetPath) return { ...node, children };
        if (node.children) return { ...node, children: updateNode(node.children) };
        return node;
      });
    }
    setRootNodes((prev) => updateNode(prev));
  }, []);

  const removeNode = useCallback((targetPath: string) => {
    function remove(nodes: FileNode[]): FileNode[] {
      return nodes
        .filter((n) => n.path !== targetPath)
        .map((n) => n.children ? { ...n, children: remove(n.children) } : n);
    }
    setRootNodes((prev) => remove(prev));
  }, []);

  const renameNode = useCallback((oldPath: string, newPath: string, newName: string) => {
    function rename(nodes: FileNode[]): FileNode[] {
      return nodes.map((n) => {
        if (n.path === oldPath) return { ...n, path: newPath, name: newName };
        if (n.children) return { ...n, children: rename(n.children) };
        return n;
      });
    }
    setRootNodes((prev) => rename(prev));
  }, []);

  return {
    rootPath,
    rootNodes,
    expandedPaths,
    setRootPath,
    setRootNodes,
    toggleExpand,
    isExpanded,
    updateChildren,
    removeNode,
    renameNode,
  };
}
