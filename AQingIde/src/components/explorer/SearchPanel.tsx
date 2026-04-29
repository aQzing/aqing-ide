import React, { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ExplorerState } from "../../store/explorerStore";

interface SearchResult {
  file: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchPanelProps {
  explorer: ExplorerState;
  onOpenFile: (path: string, name: string, line?: number, matchStart?: number, matchEnd?: number) => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ explorer, onOpenFile }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string, cs: boolean, rx: boolean) => {
    if (!q.trim() || !explorer.rootPath) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setSearched(false);
    setRegexError(null);
    try {
      const res = await invoke<SearchResult[]>("search_in_files", {
        rootPath: explorer.rootPath,
        query: q.trim(),
        caseSensitive: cs,
        useRegex: rx,
      });
      setResults(res);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("正则表达式错误")) {
        setRegexError(msg);
      }
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }, [explorer.rootPath]);

  // 自动触发搜索（400ms 防抖）
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setRegexError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      doSearch(query, caseSensitive, useRegex);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, caseSensitive, useRegex, doSearch]);

  // 按文件分组
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.file]) acc[r.file] = [];
    acc[r.file].push(r);
    return acc;
  }, {});

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 7px",
    fontSize: "12px",
    fontFamily: "monospace",
    border: `1px solid ${active ? "#007acc" : "#555"}`,
    borderRadius: "3px",
    background: active ? "rgba(0,122,204,0.2)" : "transparent",
    color: active ? "#4fc1ff" : "#888",
    cursor: "pointer",
    flexShrink: 0,
    userSelect: "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 标题 */}
      <div style={{ padding: "6px 12px", color: "#bbbbbb", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
        搜索
      </div>

      {/* 搜索框 + 选项 */}
      <div style={{ padding: "4px 8px 8px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={explorer.rootPath ? "在文件中搜索..." : "请先打开文件夹"}
            disabled={!explorer.rootPath}
            style={{
              flex: 1,
              backgroundColor: "#3c3c3c",
              color: "#cccccc",
              fontSize: "13px",
              padding: "5px 8px",
              border: "1px solid #555",
              borderRadius: "3px",
              outline: "none",
              minWidth: 0,
            }}
            autoFocus
          />
          {/* 区分大小写 */}
          <button
            title="区分大小写 (Alt+C)"
            onClick={() => setCaseSensitive((v) => !v)}
            style={toggleBtnStyle(caseSensitive)}
          >
            Aa
          </button>
          {/* 正则匹配 */}
          <button
            title="使用正则表达式 (Alt+R)"
            onClick={() => setUseRegex((v) => !v)}
            style={toggleBtnStyle(useRegex)}
          >
            .*
          </button>
        </div>

        {/* 当前选项提示 */}
        {(caseSensitive || useRegex) && (
          <div style={{ marginTop: "4px", fontSize: "11px", color: "#888", display: "flex", gap: "8px" }}>
            {caseSensitive && <span style={{ color: "#4fc1ff" }}>区分大小写</span>}
            {useRegex && <span style={{ color: "#4fc1ff" }}>正则匹配</span>}
          </div>
        )}
      </div>

      {/* 结果区域 */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {!explorer.rootPath && (
          <div style={{ color: "#666", fontSize: "12px", padding: "12px", textAlign: "center" }}>
            请先打开文件夹
          </div>
        )}

        {searching && (
          <div style={{ color: "#888", fontSize: "12px", padding: "12px", textAlign: "center" }}>
            搜索中...
          </div>
        )}

        {regexError && (
          <div style={{ color: "#f48771", fontSize: "12px", padding: "8px 12px", backgroundColor: "rgba(244,135,113,0.1)", margin: "0 8px", borderRadius: "3px" }}>
            {regexError}
          </div>
        )}

        {searched && !searching && !regexError && results.length === 0 && (
          <div style={{ color: "#888", fontSize: "12px", padding: "12px", textAlign: "center" }}>
            未找到结果
          </div>
        )}

        {searched && results.length > 0 && (
          <div style={{ padding: "0 0 8px" }}>
            <div style={{ color: "#888", fontSize: "11px", padding: "4px 12px 6px" }}>
              {results.length} 个结果，{Object.keys(grouped).length} 个文件
            </div>
            {Object.entries(grouped).map(([file, items]) => (
              <FileResultGroup
                key={file}
                file={file}
                items={items}
                rootPath={explorer.rootPath ?? ""}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface FileResultGroupProps {
  file: string;
  items: SearchResult[];
  rootPath: string;
  onOpenFile: (path: string, name: string, line?: number, matchStart?: number, matchEnd?: number) => void;
}

const FileResultGroup: React.FC<FileResultGroupProps> = ({ file, items, rootPath, onOpenFile }) => {
  const [collapsed, setCollapsed] = useState(false);
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFile = file.replace(/\\/g, "/");
  const relativePath = normalizedFile.startsWith(normalizedRoot)
    ? normalizedFile.slice(normalizedRoot.length).replace(/^\//, "")
    : normalizedFile;
  const fileName = normalizedFile.split("/").pop() ?? file;

  return (
    <div>
      {/* 文件名行 */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 12px",
          cursor: "pointer",
          color: "#cccccc",
          fontSize: "13px",
          fontWeight: 500,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "#2a2d2e"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
      >
        <span style={{ fontSize: "10px", color: "#888", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", display: "inline-block", transition: "transform 0.15s" }}>▾</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={relativePath}>
          {fileName}
        </span>
        <span style={{ fontSize: "10px", color: "#888", flexShrink: 0, marginLeft: "4px" }}>
          {relativePath !== fileName ? relativePath.replace(fileName, "").replace(/\/$/, "") : ""}
        </span>
        <span style={{ fontSize: "11px", color: "#888", flexShrink: 0, backgroundColor: "#3c3c3c", padding: "0 5px", borderRadius: "10px" }}>{items.length}</span>
      </div>

      {/* 匹配行 */}
      {!collapsed && items.map((item, i) => (
        <div
          key={i}
          onClick={() => onOpenFile(item.file, fileName, item.line, item.matchStart, item.matchEnd)}
          style={{
            padding: "2px 12px 2px 28px",
            cursor: "pointer",
            fontSize: "12px",
            color: "#888",
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "#2a2d2e"; (e.currentTarget as HTMLDivElement).style.color = "#cccccc"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLDivElement).style.color = "#888"; }}
          title={`第 ${item.line} 行: ${item.text.trim()}`}
        >
          <span style={{ color: "#666", marginRight: "8px", minWidth: "28px", display: "inline-block", textAlign: "right" }}>{item.line}</span>
          <HighlightedText text={item.text} start={item.matchStart} end={item.matchEnd} />
        </div>
      ))}
    </div>
  );
};

const HighlightedText: React.FC<{ text: string; start: number; end: number }> = ({ text, start, end }) => {
  // 计算 trim 偏移量，修正高亮位置
  const trimOffset = text.length - text.trimStart().length;
  const displayText = text.trim();
  const s = Math.max(0, start - trimOffset);
  const e = Math.min(displayText.length, Math.max(0, end - trimOffset));

  if (s >= displayText.length || s >= e) {
    return <span>{displayText}</span>;
  }

  return (
    <span>
      {displayText.slice(0, s)}
      <span style={{ color: "#ffffff", backgroundColor: "#613315", borderRadius: "2px", padding: "0 1px" }}>
        {displayText.slice(s, e)}
      </span>
      {displayText.slice(e)}
    </span>
  );
};

export default SearchPanel;
