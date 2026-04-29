import { useState, useCallback } from "react";

// 文件 Tab 数据结构
export interface FileTab {
  id: string;          // 唯一标识，使用文件路径
  path: string;        // 文件完整路径
  name: string;        // 文件名
  content: string;     // 文件内容
  originalContent: string; // 原始内容，用于判断是否有未保存修改
  language: string;    // Monaco 语言模式
  cursorLine: number;  // 光标行
  cursorColumn: number; // 光标列
}

export interface PendingNavigation {
  tabId: string;
  line: number;
  matchStart?: number;
  matchEnd?: number;
}

// AI 右键菜单触发的 Chat 命令
export type AiChatCommandType = '/explain' | '/fix' | '/refactor' | '/tests';

export interface PendingChatCommand {
  command: AiChatCommandType;
  code: string;
  language: string;
  timestamp: number; // 用于 useEffect 依赖触发
}

export interface EditorState {
  tabs: FileTab[];
  activeTabId: string | null;
  pendingNavigation: PendingNavigation | null;
  openFile: (path: string, name: string, content: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  updateCursor: (id: string, line: number, column: number) => void;
  navigateTo: (tabId: string, line: number, matchStart?: number, matchEnd?: number) => void;
  clearNavigation: () => void;
  /**
   * 强制刷新指定 tab 的内容（外部已从磁盘读到最新内容后调用）。
   * 同时更新 content 和 originalContent，使 tab 回到"已保存"状态。
   */
  forceUpdateContent: (id: string, content: string) => void;
  /**
   * 查找与给定文件路径匹配的 tab（路径规范化后对比）。
   * 返回找到的 tab，或 undefined。
   */
  findTabByPath: (filePath: string) => FileTab | undefined;
}

// 根据文件扩展名获取 Monaco 语言模式
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rs: "rust",
    json: "json",
    jsonc: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    md: "markdown",
    mdx: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    ps1: "powershell",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    lua: "lua",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    dockerfile: "dockerfile",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

// 使用 React useState 实现编辑器状态（不引入额外依赖）
export function useEditorStore(): EditorState {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  const openFile = useCallback((path: string, name: string, content: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === path);
      if (existing) {
        // 文件已打开，只切换激活
        setActiveTabId(path);
        return prev;
      }
      const newTab: FileTab = {
        id: path,
        path,
        name,
        content,
        originalContent: content,
        language: getLanguageFromPath(path),
        cursorLine: 1,
        cursorColumn: 1,
      };
      setActiveTabId(path);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((currentActive) => {
        if (currentActive !== id) return currentActive;
        if (next.length === 0) return null;
        // 激活相邻 Tab
        const newIdx = Math.min(idx, next.length - 1);
        return next[newIdx].id;
      });
      return next;
    });
  }, []);

  const closeOtherTabs = useCallback((id: string) => {
    setTabs((prev) => {
      const kept = prev.filter((t) => t.id === id);
      setActiveTabId(id);
      return kept;
    });
  }, []);

  const closeTabsToLeft = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx <= 0) return prev;
      const next = prev.slice(idx);
      setActiveTabId((cur) => (next.find((t) => t.id === cur) ? cur : id));
      return next;
    });
  }, []);

  const closeTabsToRight = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.slice(0, idx + 1);
      setActiveTabId((cur) => (next.find((t) => t.id === cur) ? cur : id));
      return next;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const updateContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content } : t))
    );
  }, []);

  const markSaved = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, originalContent: t.content } : t
      )
    );
  }, []);

  const updateCursor = useCallback((id: string, line: number, column: number) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, cursorLine: line, cursorColumn: column } : t
      )
    );
  }, []);

  const navigateTo = useCallback((tabId: string, line: number, matchStart?: number, matchEnd?: number) => {
    setPendingNavigation({ tabId, line, matchStart, matchEnd });
  }, []);

  const clearNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  /**
   * 路径规范化：统一使用正斜杠，便于跨平台对比。
   * Windows 路径 C:\foo\bar → C:/foo/bar
   */
  const normalizePath = (p: string) => p.replace(/\\/g, "/");

  const findTabByPath = useCallback(
    (filePath: string): FileTab | undefined => {
      const normalized = normalizePath(filePath);
      return tabs.find((t) => normalizePath(t.path) === normalized);
    },
    [tabs]
  );

  /**
   * 强制刷新指定 tab 的内容，同步 content 和 originalContent。
   * 仅当 tab 存在时执行，不影响其他 tab。
   * 若新内容与现有 content 完全相同，则只对齐 originalContent（不触发编辑器重渲染）。
   */
  const forceUpdateContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        // 内容已是最新，只对齐 originalContent（消除脏标记）
        if (t.content === content) return { ...t, originalContent: content };
        return { ...t, content, originalContent: content };
      })
    );
  }, []);

  return {
    tabs,
    activeTabId,
    pendingNavigation,
    openFile,
    closeTab,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
    closeAllTabs,
    setActiveTab,
    updateContent,
    markSaved,
    updateCursor,
    navigateTo,
    clearNavigation,
    forceUpdateContent,
    findTabByPath,
  };
}
