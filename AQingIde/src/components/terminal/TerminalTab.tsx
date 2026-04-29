import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface TerminalOutput {
  terminal_id: string;
  data: string;
  is_stderr: boolean;
  exit_code: number | null;
}

interface TerminalTabProps {
  id: string;
  cwd: string;
  isActive: boolean;
}

// ─── 命令历史 Hook ────────────────────────────────────────────────────────────

function useCommandHistory() {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const push = useCallback((cmd: string) => {
    if (!cmd.trim()) return;
    setHistory((prev) => {
      // 去重：如果最后一条相同则不重复添加
      if (prev[prev.length - 1] === cmd) return prev;
      return [...prev, cmd];
    });
    setHistoryIndex(-1);
  }, []);

  const navigate = useCallback(
    (direction: "up" | "down", currentInput: string): string => {
      setHistory((prev) => {
        if (prev.length === 0) return prev;
        setHistoryIndex((idx) => {
          if (direction === "up") {
            const newIdx = idx === -1 ? prev.length - 1 : Math.max(0, idx - 1);
            return newIdx;
          } else {
            const newIdx = idx === -1 ? -1 : Math.min(prev.length - 1, idx + 1);
            return newIdx;
          }
        });
        return prev;
      });
      // 返回值通过 ref 获取，这里只触发状态更新
      return currentInput;
    },
    []
  );

  return { history, historyIndex, push, navigate };
}

// ─── TerminalTab 组件 ─────────────────────────────────────────────────────────

const TerminalTab: React.FC<TerminalTabProps> = ({ id, cwd, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [inputValue, setInputValue] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentCwd, setCurrentCwd] = useState(cwd);

  // 当父组件传入真实路径时（工作区异步加载完成），同步更新 currentCwd
  // 仅在用户尚未手动 cd（currentCwd 仍为默认 "."）时才覆盖
  useEffect(() => {
    if (cwd && cwd !== ".") {
      setCurrentCwd((prev) => (prev === "." ? cwd : prev));
    }
  }, [cwd]);
  const inputRef = useRef<HTMLInputElement>(null);

  // 命令历史
  const { history, historyIndex, push } = useCommandHistory();
  const historyIndexRef = useRef(-1);
  const historyRef = useRef<string[]>([]);

  // 同步 ref（避免闭包陷阱）
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  // ── 初始化 xterm ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#aeafad",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
      },
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      cursorBlink: true,
      scrollback: 1000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // 延迟 fit，确保容器已有尺寸
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // 容器尺寸为 0 时 fit 会抛出，忽略
      }
    }, 50);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 欢迎信息
    term.writeln("\x1b[1;32mAQingIDE Terminal\x1b[0m  \x1b[90m(命令执行模式)\x1b[0m");
    term.writeln(`\x1b[90m工作目录: ${cwd}\x1b[0m`);
    term.writeln("");

    // ResizeObserver 自动 fit
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }
    resizeObserverRef.current = ro;

    // 监听 Tauri 终端输出事件
    const setupListener = async () => {
      const unlisten = await listen<TerminalOutput>(
        `terminal-output-${id}`,
        (event) => {
          const payload = event.payload;
          if (payload.exit_code !== null) {
            // 命令执行完毕
            setIsRunning(false);
            if (payload.exit_code !== 0) {
              term.writeln(
                `\x1b[90m[退出码: ${payload.exit_code}]\x1b[0m`
              );
            }
            term.write("\x1b[32m$ \x1b[0m");
            // 聚焦输入框
            setTimeout(() => inputRef.current?.focus(), 50);
          } else if (payload.data) {
            // 写入输出（stderr 用红色）
            const text = payload.data.replace(/\r?\n/g, "\r\n");
            if (payload.is_stderr) {
              term.write(`\x1b[31m${text}\x1b[0m`);
            } else {
              term.write(text);
            }
          }
        }
      );
      unlistenRef.current = unlisten;
    };
    setupListener();

    return () => {
      ro.disconnect();
      unlistenRef.current?.();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 面板激活时重新 fit 并聚焦
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
        }
        inputRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  // ── 执行命令 ──────────────────────────────────────────────────────────────
  const executeCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed || !termRef.current) return;

      const term = termRef.current;

      // 处理内置命令
      if (trimmed === "clear" || trimmed === "cls") {
        term.clear();
        term.write("\x1b[32m$ \x1b[0m");
        setInputValue("");
        return;
      }

      // cd 命令：更新工作目录
      if (trimmed.startsWith("cd ")) {
        const newDir = trimmed.slice(3).trim();
        // 通过执行 cd 并 pwd 来获取新路径
        term.writeln(`\x1b[90m$ ${trimmed}\x1b[0m`);
        push(trimmed);
        setInputValue("");
        setIsRunning(true);

        try {
          await invoke("terminal_execute", {
            terminalId: id,
            command: trimmed,
            cwd: currentCwd,
          });
          // cd 后更新 cwd（简单处理：拼接路径）
          if (newDir.startsWith("/") || /^[A-Za-z]:/.test(newDir)) {
            setCurrentCwd(newDir);
          } else if (newDir === "..") {
            const parts = currentCwd.replace(/\\/g, "/").split("/");
            parts.pop();
            setCurrentCwd(parts.join("/") || "/");
          } else {
            setCurrentCwd(`${currentCwd}/${newDir}`);
          }
        } catch (err) {
          term.writeln(`\x1b[31m执行失败: ${err}\x1b[0m`);
          term.write("\x1b[32m$ \x1b[0m");
          setIsRunning(false);
        }
        return;
      }

      // 普通命令
      term.writeln(`\x1b[90m$ ${trimmed}\x1b[0m`);
      push(trimmed);
      setInputValue("");
      setIsRunning(true);

      try {
        await invoke("terminal_execute", {
          terminalId: id,
          command: trimmed,
          cwd: currentCwd,
        });
      } catch (err) {
        term.writeln(`\x1b[31m执行失败: ${err}\x1b[0m`);
        term.write("\x1b[32m$ \x1b[0m");
        setIsRunning(false);
      }
    },
    [id, currentCwd, push]
  );

  // ── 键盘事件处理 ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        executeCommand(inputValue);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const h = historyRef.current;
        if (h.length === 0) return;
        const newIdx =
          historyIndexRef.current === -1
            ? h.length - 1
            : Math.max(0, historyIndexRef.current - 1);
        historyIndexRef.current = newIdx;
        setInputValue(h[newIdx] ?? "");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const h = historyRef.current;
        const newIdx = historyIndexRef.current + 1;
        if (newIdx >= h.length) {
          historyIndexRef.current = -1;
          setInputValue("");
        } else {
          historyIndexRef.current = newIdx;
          setInputValue(h[newIdx] ?? "");
        }
      } else if (e.key === "c" && e.ctrlKey) {
        // Ctrl+C：中断（目前只清空输入）
        setInputValue("");
        termRef.current?.writeln("^C");
        setIsRunning(false);
      }
    },
    [inputValue, executeCommand]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "#1e1e1e",
      }}
    >
      {/* xterm 渲染区域 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "hidden",
          padding: "4px 8px",
          cursor: "text",
        }}
        onClick={() => inputRef.current?.focus()}
      />

      {/* 命令输入栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderTop: "1px solid #333",
          backgroundColor: "#252526",
          padding: "4px 8px",
          gap: "6px",
          flexShrink: 0,
        }}
      >
        {/* 工作目录 */}
        <span
          style={{
            color: "#569cd6",
            fontSize: "12px",
            fontFamily: "Consolas, monospace",
            whiteSpace: "nowrap",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
          }}
          title={currentCwd}
        >
          {currentCwd.split(/[/\\]/).pop() ?? currentCwd}
        </span>

        <span style={{ color: "#4ec9b0", fontSize: "12px", fontFamily: "Consolas, monospace", flexShrink: 0 }}>
          $
        </span>

        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder={isRunning ? "执行中..." : "输入命令..."}
          style={{
            flex: 1,
            backgroundColor: "transparent",
            border: "none",
            outline: "none",
            color: isRunning ? "#666" : "#cccccc",
            fontSize: "13px",
            fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
            caretColor: "#aeafad",
          }}
          autoComplete="off"
          spellCheck={false}
        />

        {isRunning && (
          <span style={{ color: "#666", fontSize: "11px", flexShrink: 0 }}>
            运行中
          </span>
        )}
      </div>
    </div>
  );
};

export default TerminalTab;
