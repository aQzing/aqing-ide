import React, { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AiSettingsState } from "../../store/aiSettingsStore";
import type { FileTab, PendingChatCommand, AiChatCommandType } from "../../store/editorStore";
import { useInputHistory, type InputHistoryItem } from "../../hooks/useInputHistory";
import { filterCommands, matchBuiltinCommand, type SlashCommand } from "../../hooks/slashCommands";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/**
 * Agent 执行阶段的暂存文件变更（尚未写入磁盘）
 */
export interface PendingChange {
  /** 文件绝对路径 */
  filePath: string;
  /** 写入前的原始内容（null = 新建文件） */
  oldContent: string | null;
  /** 待写入的新内容 */
  newContent: string;
  /** 是否为新建文件 */
  isNew: boolean;
  /** 预计算的行级 diff（展示用） */
  diff: FileDiff;
}

/** 子任务状态 */
export type SubTaskStatus = "pending" | "running" | "done" | "error";

/** 子任务 */
export interface SubTask {
  id: string;
  title: string;
  status: SubTaskStatus;
  /** 耗时（ms），done 后填入 */
  elapsed?: number;
  startedAt?: number;
}

/** 任务计划 */
export interface TaskPlan {
  id: string;
  title: string;
  tasks: SubTask[];
  /** confirmed: 用户确认执行；cancelled: 用户取消；pending: 等待确认 */
  state: "pending" | "confirmed" | "cancelled";
}

/** Diff 行 */
export interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** Diff 块 */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** 文件 Diff */
export interface FileDiff {
  filePath: string;
  addCount: number;
  removeCount: number;
  hunks: DiffHunk[];
  /** 写入前的原始内容（null=新建文件，undefined=手动 diff 不存在） */
  originalContent?: string | null;
  /** 是否已写入磁盘（agent 自动写入） */
  isAutoWritten?: boolean;
}

/** think 块解析结果 */
interface ThinkSegment {
  type: "think" | "text";
  content: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  isStreaming?: boolean;
  error?: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** Agent 工具调用气泡标记 */
  isToolCall?: boolean;
  /** Agent 工具结果气泡标记 */
  isToolResult?: boolean;
  /** 任务计划（功能三） */
  taskPlan?: TaskPlan;
  /** 文件 Diff 列表（功能三） */
  diffs?: FileDiff[];
  /** 历史记录面板标记 */
  isHistoryPanel?: boolean;
  /**
   * Agent 完成后的暂存变更列表（尚未写入磁盘）
   * 展示在最终回复消息下方的 FileChangeSummaryPanel
   */
  pendingChanges?: PendingChange[];
}

interface AiStreamEvent {
  request_id: string;
  delta: string;
  done: boolean;
  error?: string;
}

interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface AgentStepResponse {
  content: string | null;
  tool_calls: AgentToolCall[];
  finish_reason: string;
}

/** 发给 Rust ai_agent_step 的消息格式 */
interface AgentMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ChatPanelProps {
  aiSettings: AiSettingsState;
  activeTab: FileTab | null;
  workspacePath: string | null;
  pendingChatCommand?: PendingChatCommand | null;
  onClearPendingCommand?: () => void;
}

// 斜杠命令对应的系统提示附加指令
const SLASH_COMMAND_PROMPTS: Record<AiChatCommandType, string> = {
  '/explain':  '请详细解释以下代码的功能、实现原理和关键逻辑：',
  '/fix':      '请找出以下代码中的 bug 和问题，并给出修复方案：',
  '/refactor': '请重构以下代码，提升可读性、可维护性和性能，并说明改动原因：',
  '/tests':    '请为以下代码生成完整的单元测试，覆盖主要功能和边界情况：',
};

// Agent 工具定义（OpenAI function calling 格式）
const AGENT_TOOLS: Array<{
  type: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}> = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文件内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件的绝对路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入文件内容（会覆盖现有内容）",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件的绝对路径" },
          content: { type: "string", description: "要写入的内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "列出目录内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录的绝对路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "在终端执行 shell 命令",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
          cwd: { type: "string", description: "工作目录（可选）" },
        },
        required: ["command"],
      },
    },
  },
];

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 将消息内容解析为 think 块和普通文本块的混合数组
 * 支持多个 <think>...</think> 块
 */
function parseThinkBlocks(text: string): ThinkSegment[] {
  const segments: ThinkSegment[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "think", content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}

/**
 * 检测流式输出中是否存在未闭合的 <think> 标签（思考中状态）
 */
function hasUnclosedThink(text: string): boolean {
  const openCount = (text.match(/<think>/g) ?? []).length;
  const closeCount = (text.match(/<\/think>/g) ?? []).length;
  return openCount > closeCount;
}

/**
 * 行级 Diff 算法（基于 LCS）
 * 返回 FileDiff 对象
 */
function computeLineDiff(filePath: string, oldContent: string | null, newContent: string): FileDiff {
  const oldLines = oldContent === null ? [] : oldContent.split("\n");
  const newLines = newContent.split("\n");

  // 如果是新建文件，全部为新增行
  if (oldContent === null) {
    const hunks: DiffHunk[] = [];
    if (newLines.length > 0) {
      hunks.push({
        header: `@@ -0,0 +1,${newLines.length} @@`,
        lines: newLines.map((line) => ({ type: "add" as const, content: line })),
      });
    }
    return { filePath, addCount: newLines.length, removeCount: 0, hunks };
  }

  // LCS 差分核心
  const n = oldLines.length;
  const m = newLines.length;

  // 构建 LCS 表（使用 1-indexed）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成 diff 操作序列
  type RawDiffOp = { type: "context" | "add" | "remove"; oldLine?: number; newLine?: number; content: string };
  const ops: RawDiffOp[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "context", oldLine: i, newLine: j, content: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", newLine: j, content: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: "remove", oldLine: i, content: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // 将操作序列按连续的 context（上下文）分组为 hunks
  // 每个 hunk 包含变更行及其前后各 3 行 context
  const CONTEXT_LINES = 3;
  // 找出所有变更行索引
  const changedIdxs: number[] = ops.reduce<number[]>((acc, op, idx) => {
    if (op.type !== "context") acc.push(idx);
    return acc;
  }, []);

  if (changedIdxs.length === 0) {
    return { filePath, addCount: 0, removeCount: 0, hunks: [] };
  }

  // 将变更行合并为 hunk 范围（扩展 context）
  const hunkRanges: Array<{ start: number; end: number }> = [];
  let hunkStart = Math.max(0, changedIdxs[0] - CONTEXT_LINES);
  let hunkEnd = Math.min(ops.length - 1, changedIdxs[0] + CONTEXT_LINES);
  for (let k = 1; k < changedIdxs.length; k++) {
    const expanded = Math.max(0, changedIdxs[k] - CONTEXT_LINES);
    if (expanded <= hunkEnd + 1) {
      hunkEnd = Math.min(ops.length - 1, changedIdxs[k] + CONTEXT_LINES);
    } else {
      hunkRanges.push({ start: hunkStart, end: hunkEnd });
      hunkStart = expanded;
      hunkEnd = Math.min(ops.length - 1, changedIdxs[k] + CONTEXT_LINES);
    }
  }
  hunkRanges.push({ start: hunkStart, end: hunkEnd });

  let addCount = 0;
  let removeCount = 0;
  const hunks: DiffHunk[] = hunkRanges.map(({ start, end }) => {
    const slice = ops.slice(start, end + 1);
    const firstOld = slice.find((op) => op.oldLine !== undefined)?.oldLine ?? 1;
    const firstNew = slice.find((op) => op.newLine !== undefined)?.newLine ?? 1;
    const oldLen = slice.filter((op) => op.type !== "add").length;
    const newLen = slice.filter((op) => op.type !== "remove").length;
    const header = `@@ -${firstOld},${oldLen} +${firstNew},${newLen} @@`;
    const lines: DiffLine[] = slice.map((op) => {
      if (op.type === "add") addCount++;
      if (op.type === "remove") removeCount++;
      return { type: op.type, content: op.content, oldLineNo: op.oldLine, newLineNo: op.newLine };
    });
    return { header, lines };
  });

  return { filePath, addCount, removeCount, hunks };
}

/** 格式化时间戳为 HH:mm */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** 格式化时间戳为完整 YYYY-MM-DD HH:mm:ss */
function formatFullTime(ts: number): string {
  const d = new Date(ts);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

/** 解析 AI 返回的任务计划文本（格式：## 任务计划\n1. xxx\n2. xxx） */
function parseTaskPlan(text: string): TaskPlan | null {
  const planMatch = text.match(/##\s*任务计划[\s\S]*?(?=##|$)/);
  if (!planMatch) return null;
  const lines = planMatch[0].split("\n").filter((l) => /^\d+\./.test(l.trim()));
  if (lines.length < 2) return null;
  return {
    id: generateId(),
    title: "任务计划",
    state: "pending",
    tasks: lines.map((l, i) => ({
      id: `task-${i}`,
      title: l.replace(/^\d+\.\s*/, "").trim(),
      status: "pending",
    })),
  };
}

/** 解析 AI 返回的 diff 文本（标准 unified diff 格式） */
function parseDiff(text: string): FileDiff[] {
  const diffs: FileDiff[] = [];
  // 匹配 diff 代码块
  const diffBlockRegex = /```diff\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = diffBlockRegex.exec(text)) !== null) {
    const raw = match[1];
    const lines = raw.split("\n");
    let filePath = "unknown";
    let addCount = 0;
    let removeCount = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      if (line.startsWith("+++ ")) {
        filePath = line.slice(4).replace(/^b\//, "").trim();
      } else if (line.startsWith("@@ ")) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
      } else if (currentHunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentHunk.lines.push({ type: "add", content: line.slice(1) });
          addCount++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          currentHunk.lines.push({ type: "remove", content: line.slice(1) });
          removeCount++;
        } else {
          currentHunk.lines.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line });
        }
      }
    }

    if (hunks.length > 0) {
      diffs.push({ filePath, addCount, removeCount, hunks });
    }
  }
  return diffs;
}

// ─── CommandMenu：命令提示下拉菜单 ──────────────────────────────────────────

interface CommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

const CommandMenu: React.FC<CommandMenuProps> = ({ commands, selectedIndex, onSelect }) => {
  if (commands.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 4px)",
        left: 0,
        right: 0,
        backgroundColor: "#2d2d2d",
        border: "1px solid #484848",
        borderRadius: "6px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        zIndex: 1000,
        overflow: "hidden",
      }}
    >
      {/* 菜单头部 */}
      <div
        style={{
          padding: "4px 10px",
          fontSize: "10px",
          color: "#555",
          borderBottom: "1px solid #3a3a3a",
          userSelect: "none",
        }}
      >
        命令 · ↑↓ 选择 · Enter 执行 · Esc 关闭
      </div>
      {/* 命令列表 */}
      {commands.map((cmd, idx) => (
        <div
          key={cmd.name}
          onClick={() => onSelect(cmd)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "7px 10px",
            cursor: "pointer",
            backgroundColor: idx === selectedIndex ? "rgba(0,122,204,0.18)" : "transparent",
            borderLeft: `2px solid ${idx === selectedIndex ? "#007acc" : "transparent"}`,
            transition: "background-color 0.1s",
          }}
          onMouseEnter={(e) => {
            if (idx !== selectedIndex) {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
            }
          }}
          onMouseLeave={(e) => {
            if (idx !== selectedIndex) {
              e.currentTarget.style.backgroundColor = "transparent";
            }
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#569cd6",
              fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
              flexShrink: 0,
              minWidth: "80px",
            }}
          >
            {cmd.name}
          </span>
          <span style={{ fontSize: "12px", color: "#888" }}>{cmd.description}</span>
        </div>
      ))}
    </div>
  );
};

// ─── HistoryPanel：历史记录面板（作为系统消息展示在对话区） ────────────────

interface HistoryPanelProps {
  history: InputHistoryItem[];
  onUse: (content: string) => void;
  onDismiss: () => void;
}

/** 单条历史记录项 */
const HistoryPanelItem: React.FC<{
  item: InputHistoryItem;
  index: number;
  onUse: (content: string) => void;
}> = ({ item, index, onUse }) => {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const lines = item.content.split("\n");
  const isLong = lines.length > 2 || item.content.length > 120;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "7px 10px",
        borderRadius: "4px",
        backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background-color 0.1s",
        cursor: "default",
      }}
    >
      {/* 序号 */}
      <span
        style={{
          fontSize: "11px",
          color: "#555",
          flexShrink: 0,
          minWidth: "24px",
          fontFamily: "'Cascadia Code', Consolas, monospace",
          paddingTop: "1px",
        }}
      >
        #{index + 1}
      </span>

      {/* 主内容区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 时间戳 */}
        <div style={{ fontSize: "10px", color: "#555", marginBottom: "2px" }}>
          {formatFullTime(item.timestamp)}
        </div>

        {/* 消息内容 */}
        <div
          style={{
            fontSize: "12px",
            color: "#cccccc",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: expanded ? "visible" : "hidden",
            display: expanded ? "block" : "-webkit-box",
            WebkitLineClamp: expanded ? undefined : 2,
            WebkitBoxOrient: expanded ? undefined : "vertical",
          }}
        >
          {item.content}
        </div>

        {/* 展开/收起按钮 */}
        {isLong && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: "2px",
              background: "none",
              border: "none",
              color: "#555",
              cursor: "pointer",
              fontSize: "10px",
              padding: "1px 0",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#888")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
          >
            {expanded ? "▲ 收起" : "▼ 展开"}
          </button>
        )}
      </div>

      {/* 「使用」按钮（悬停时显示） */}
      <button
        onClick={() => onUse(item.content)}
        style={{
          flexShrink: 0,
          padding: "3px 10px",
          fontSize: "11px",
          backgroundColor: hovered ? "rgba(0,122,204,0.2)" : "transparent",
          color: hovered ? "#4fc1ff" : "transparent",
          border: `1px solid ${hovered ? "#007acc" : "transparent"}`,
          borderRadius: "3px",
          cursor: "pointer",
          transition: "all 0.15s",
          whiteSpace: "nowrap",
          alignSelf: "center",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(0,122,204,0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = hovered ? "rgba(0,122,204,0.2)" : "transparent";
        }}
      >
        使用
      </button>
    </div>
  );
};

const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, onUse, onDismiss }) => {
  return (
    <div
      style={{
        backgroundColor: "#1e1e2e",
        border: "1px solid #3c3c5c",
        borderRadius: "6px",
        overflow: "hidden",
        margin: "4px 0",
      }}
    >
      {/* 面板头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          backgroundColor: "#252540",
          borderBottom: "1px solid #3c3c5c",
        }}
      >
        <span style={{ fontSize: "12px", color: "#9d9dff", fontWeight: 600 }}>
          📋 输入历史（共 {history.length} 条）
        </span>
        <button
          onClick={onDismiss}
          title="关闭历史面板"
          style={{
            background: "none",
            border: "none",
            color: "#555",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
            padding: "2px 4px",
            borderRadius: "3px",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#aaa")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
        >
          ×
        </button>
      </div>

      {/* 历史列表 */}
      {history.length === 0 ? (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            color: "#555",
            fontSize: "12px",
          }}
        >
          暂无历史记录
        </div>
      ) : (
        <div
          style={{
            maxHeight: "400px",
            overflowY: "auto",
            padding: "4px 2px",
          }}
        >
          {history.map((item, idx) => (
            <HistoryPanelItem
              key={`${item.timestamp}-${idx}`}
              item={item}
              index={idx}
              onUse={onUse}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── ThinkBlock：思考过程折叠组件 ────────────────────────────────────────────

const ThinkBlock: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
  const [expanded, setExpanded] = useState(false);

  if (isStreaming) {
    // 流式思考中动画
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "5px 10px",
          margin: "4px 0",
          backgroundColor: "rgba(100,100,120,0.12)",
          borderLeft: "3px solid #555",
          borderRadius: "0 4px 4px 0",
          color: "#777",
          fontSize: "12px",
          fontStyle: "italic",
        }}
      >
        <span style={{ fontSize: "14px" }}>🤔</span>
        <span>思考中</span>
        <ThinkingDots />
      </div>
    );
  }

  return (
    <div
      style={{
        margin: "4px 0",
        borderLeft: "3px solid #4a4a5a",
        borderRadius: "0 4px 4px 0",
        overflow: "hidden",
        backgroundColor: "rgba(80,80,100,0.1)",
      }}
    >
      {/* 折叠头部 */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "5px 10px",
          cursor: "pointer",
          userSelect: "none",
          color: "#888",
          fontSize: "12px",
          transition: "background-color 0.1s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <span style={{ fontSize: "13px" }}>💭</span>
        <span style={{ fontWeight: 500, color: "#999" }}>思考过程</span>
        <span style={{ fontSize: "10px", color: "#555", marginLeft: "4px" }}>
          {expanded ? "▲ 收起" : "▼ 展开"}
        </span>
      </div>
      {/* 展开内容 */}
      {expanded && (
        <div
          style={{
            padding: "6px 12px 8px",
            borderTop: "1px solid rgba(100,100,120,0.2)",
            color: "#777",
            fontSize: "12px",
            fontStyle: "italic",
            lineHeight: 1.65,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
};

/** 思考中动态省略号 */
const ThinkingDots: React.FC = () => {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const timer = setInterval(() => { setDots((d) => (d.length >= 3 ? "." : d + ".")); }, 500);
    return () => clearInterval(timer);
  }, []);
  return <span>{dots}</span>;
};

// ─── 代码块复制按钮 ──────────────────────────────────────────────────────────

const CopyButton: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 降级方案
      const el = document.createElement("textarea");
      el.value = code;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      title="复制代码"
      style={{
        padding: "2px 8px",
        fontSize: "11px",
        backgroundColor: copied ? "rgba(78,201,176,0.2)" : "rgba(255,255,255,0.06)",
        color: copied ? "#4ec9b0" : "#888",
        border: `1px solid ${copied ? "#4ec9b0" : "#484848"}`,
        borderRadius: "3px",
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        lineHeight: "18px",
      }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)"; }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
    >
      {copied ? "已复制 ✓" : "复制"}
    </button>
  );
};

// ─── 代码块渲染（含复制按钮 + 语言标签） ────────────────────────────────────

/** 渲染普通文本（处理代码块） */
function renderPlainContent(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      parts.push(
        <span key={`text-${lastIndex}`} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {plain}
        </span>
      );
    }
    const lang = match[1] || "code";
    const code = match[2];
    // diff 块由 DiffBlock 组件处理，跳过普通渲染
    if (lang === "diff") {
      lastIndex = match.index + match[0].length;
      continue;
    }
    parts.push(
      <div
        key={`code-${match.index}`}
        style={{
          backgroundColor: "#1e1e1e",
          borderRadius: "4px",
          margin: "6px 0",
          overflow: "hidden",
          border: "1px solid #3c3c3c",
        }}
      >
        <div
          style={{
            padding: "3px 8px",
            backgroundColor: "#2d2d2d",
            fontSize: "11px",
            color: "#888",
            borderBottom: "1px solid #3c3c3c",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#569cd6", fontWeight: 500 }}>{lang}</span>
          <CopyButton code={code} />
        </div>
        <pre
          style={{
            margin: 0,
            padding: "10px",
            fontSize: "12px",
            color: "#d4d4d4",
            overflowX: "auto",
            fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
            lineHeight: 1.5,
          }}
        >
          {code}
        </pre>
      </div>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {text.slice(lastIndex)}
      </span>
    );
  }

  return parts.length > 0 ? parts : [<span key="empty" style={{ whiteSpace: "pre-wrap" }}>{text}</span>];
}

/**
 * 完整消息渲染：先解析 think 块，再对每段文本渲染代码块
 * isStreaming=true 时，检测未闭合的 <think> 标签并显示"思考中"动画
 */
function renderContentWithThink(text: string, isStreaming: boolean): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  // 流式输出时，如果存在未闭合 <think>，把整段处理为思考中动画
  if (isStreaming && hasUnclosedThink(text)) {
    // 已完成的 think 块先渲染，未闭合的最后一个显示为动画
    const closedPart = text.slice(0, text.lastIndexOf("<think>"));
    if (closedPart) {
      const segments = parseThinkBlocks(closedPart);
      segments.forEach((seg, idx) => {
        if (seg.type === "think") {
          nodes.push(<ThinkBlock key={`think-${idx}`} content={seg.content} />);
        } else if (seg.content.trim()) {
          nodes.push(<span key={`seg-${idx}`}>{renderPlainContent(seg.content)}</span>);
        }
      });
    }
    nodes.push(<ThinkBlock key="thinking-anim" content="" isStreaming />);
    return nodes;
  }

  const segments = parseThinkBlocks(text);
  segments.forEach((seg, idx) => {
    if (seg.type === "think") {
      nodes.push(<ThinkBlock key={`think-${idx}`} content={seg.content} />);
    } else {
      const rendered = renderPlainContent(seg.content);
      rendered.forEach((node, ni) => {
        nodes.push(<React.Fragment key={`seg-${idx}-${ni}`}>{node}</React.Fragment>);
      });
    }
  });
  return nodes;
}

// 向后兼容旧调用（工具结果等不需要 think 解析的场景）
function renderContent(text: string): React.ReactNode[] {
  return renderPlainContent(text);
}

// ─── 任务计划组件 ────────────────────────────────────────────────────────────

const TaskPlanCard: React.FC<{
  plan: TaskPlan;
  onConfirm: () => void;
  onCancel: () => void;
  /** 关联的 diff 数量（用于判断是否显示批量按钮） */
  diffCount?: number;
  onBatchConfirm?: () => void;
  onBatchRevert?: () => void;
}> = ({ plan, onConfirm, onCancel, diffCount = 0, onBatchConfirm, onBatchRevert }) => {
  const statusIcon: Record<SubTaskStatus, string> = {
    pending: "○",
    running: "◉",
    done: "✓",
    error: "✗",
  };
  const statusColor: Record<SubTaskStatus, string> = {
    pending: "#666",
    running: "#e5a00d",
    done: "#4ec9b0",
    error: "#f48771",
  };

  return (
    <div
      style={{
        backgroundColor: "#1e1e2e",
        border: "1px solid #3c3c5c",
        borderRadius: "6px",
        margin: "6px 0",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          backgroundColor: "#252540",
          borderBottom: "1px solid #3c3c5c",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span style={{ fontSize: "12px", color: "#9d9dff", fontWeight: 600 }}>任务计划</span>
        {plan.state === "confirmed" && (
          <span style={{ fontSize: "10px", color: "#4ec9b0", backgroundColor: "rgba(78,201,176,0.1)", padding: "1px 6px", borderRadius: "3px" }}>
            执行中
          </span>
        )}
        {plan.state === "cancelled" && (
          <span style={{ fontSize: "10px", color: "#888", backgroundColor: "rgba(136,136,136,0.1)", padding: "1px 6px", borderRadius: "3px" }}>
            已取消
          </span>
        )}
      </div>
      <div style={{ padding: "8px 0" }}>
        {plan.tasks.map((task, idx) => (
          <div
            key={task.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "5px 12px",
              backgroundColor: task.status === "running" ? "rgba(229,160,13,0.06)" : "transparent",
              transition: "background-color 0.2s",
            }}
          >
            <span style={{ fontSize: "13px", color: statusColor[task.status], fontFamily: "monospace", flexShrink: 0 }}>
              {statusIcon[task.status]}
            </span>
            <span style={{ fontSize: "11px", color: "#888", flexShrink: 0, width: "16px" }}>{idx + 1}.</span>
            <span
              style={{
                fontSize: "12px",
                color: task.status === "done" ? "#666" : task.status === "error" ? "#f48771" : "#cccccc",
                textDecoration: task.status === "done" ? "line-through" : "none",
                flex: 1,
              }}
            >
              {task.title}
            </span>
            {task.status === "done" && task.elapsed !== undefined && (
              <span style={{ fontSize: "10px", color: "#555", flexShrink: 0 }}>
                {task.elapsed < 1000 ? `${task.elapsed}ms` : `${(task.elapsed / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
        ))}
      </div>
      {/* 底部操作区：pending 时显示确认/取消，confirmed 且有 diff 时显示批量按钮 */}
      {plan.state === "pending" && (
        <div style={{ display: "flex", gap: "8px", padding: "8px 12px", borderTop: "1px solid #3c3c5c" }}>
          <button
            onClick={onConfirm}
            style={{ padding: "4px 14px", backgroundColor: "#007acc", color: "white", fontSize: "12px", borderRadius: "4px", border: "none", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#0088e0")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#007acc")}
          >
            确认执行
          </button>
          <button
            onClick={onCancel}
            style={{ padding: "4px 14px", backgroundColor: "transparent", color: "#888", fontSize: "12px", borderRadius: "4px", border: "1px solid #484848", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#666")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#484848")}
          >
            取消
          </button>
        </div>
      )}
      {/* 批量操作按钮：任务 confirmed 且有自动写入的 diff 时显示 */}
      {plan.state === "confirmed" && diffCount > 0 && (onBatchConfirm || onBatchRevert) && (
        <div style={{ display: "flex", gap: "8px", padding: "8px 12px", borderTop: "1px solid #3c3c5c", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: "#666", flex: 1 }}>
            本次任务修改了 {diffCount} 个文件：
          </span>
          {onBatchRevert && (
            <button
              onClick={onBatchRevert}
              style={{
                padding: "3px 12px",
                backgroundColor: "rgba(248,81,73,0.12)",
                color: "#f85149",
                border: "1px solid #f85149",
                borderRadius: "4px",
                fontSize: "11px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.22)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.12)")}
            >
              ↩ 全部撤回
            </button>
          )}
          {onBatchConfirm && (
            <button
              onClick={onBatchConfirm}
              style={{
                padding: "3px 12px",
                backgroundColor: "rgba(63,185,80,0.15)",
                color: "#3fb950",
                border: "1px solid #3fb950",
                borderRadius: "4px",
                fontSize: "11px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(63,185,80,0.25)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(63,185,80,0.15)")}
            >
              ✓ 全部确认
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Diff 展示组件 ───────────────────────────────────────────────────────────

/**
 * DiffBlock 支持两种模式：
 *   - 自动写入模式（diff.isAutoWritten=true）：文件已写入磁盘，按钮为"✓ 确认修改"和"↩ 撤回修改"
 *   - 手动 diff 模式（旧逻辑）：文件未写入，按钮为"应用更改"
 * batchConfirmTick/batchRevertTick：每次递增时触发批量操作（来自 MessageBubble）
 */
const DiffBlock: React.FC<{
  diff: FileDiff;
  workspacePath: string | null;
  batchConfirmTick?: number;
  batchRevertTick?: number;
}> = ({ diff, workspacePath: _workspacePath, batchConfirmTick = 0, batchRevertTick = 0 }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [reverted, setReverted] = useState(false);
  // 自动写入模式：确认状态
  const [confirmed, setConfirmed] = useState(false);

  // ── 手动模式专用状态 ──────────────────────────────────────
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  /** 应用前的原始内容，用于手动模式撤回 */
  const [savedOriginal, setSavedOriginal] = useState<string | null | undefined>(undefined);

  const isAutoMode = diff.isAutoWritten === true;

  // ── 批量操作响应：监听 tick 变化 ──────────────────────────
  const prevConfirmTickRef = useRef(0);
  const prevRevertTickRef = useRef(0);

  useEffect(() => {
    // 批量确认：仅在自动模式、未撤回、未确认时执行
    if (batchConfirmTick > prevConfirmTickRef.current) {
      prevConfirmTickRef.current = batchConfirmTick;
      if (isAutoMode && !reverted && !confirmed) {
        setConfirmed(true);
      }
    }
  }, [batchConfirmTick, isAutoMode, reverted, confirmed]);

  useEffect(() => {
    // 批量撤回：仅在自动模式、未撤回时执行
    if (batchRevertTick > prevRevertTickRef.current) {
      prevRevertTickRef.current = batchRevertTick;
      if (isAutoMode && !reverted && !reverting) {
        // 静默撤回（批量操作不弹确认框）
        void (async () => {
          setReverting(true);
          try {
            const origContent = diff.originalContent;
            if (origContent === null) {
              await invoke("delete_path", { path: diff.filePath });
            } else if (origContent !== undefined) {
              await invoke("write_file_content", { path: diff.filePath, content: origContent });
            }
            setReverted(true);
            setConfirmed(false);
          } catch (err) {
            console.error("批量撤回失败:", err);
          } finally {
            setReverting(false);
          }
        })();
      }
    }
  }, [batchRevertTick, isAutoMode, reverted, reverting, diff.filePath, diff.originalContent]);
  const handleApply = useCallback(async () => {
    if (applied || applying) return;
    const ok = window.confirm(`应用更改到文件：\n${diff.filePath}\n\n确认？`);
    if (!ok) return;
    setApplying(true);
    try {
      let originalContent: string | null = null;
      try {
        originalContent = await invoke<string>("read_file_content", { path: diff.filePath });
      } catch {
        originalContent = null;
      }
      const newLines: string[] = [];
      const origLines = (originalContent ?? "").split("\n");
      let origIdx = 0;
      for (const hunk of diff.hunks) {
        const headerMatch = hunk.header.match(/@@ -(\d+)/);
        const startLine = headerMatch ? parseInt(headerMatch[1], 10) - 1 : origIdx;
        while (origIdx < startLine) { newLines.push(origLines[origIdx] ?? ""); origIdx++; }
        for (const line of hunk.lines) {
          if (line.type === "add") { newLines.push(line.content); }
          else if (line.type === "context") { newLines.push(origLines[origIdx] ?? line.content); origIdx++; }
          else if (line.type === "remove") { origIdx++; }
        }
      }
      while (origIdx < origLines.length) { newLines.push(origLines[origIdx]); origIdx++; }
      await invoke("write_file_content", { path: diff.filePath, content: newLines.join("\n") });
      setSavedOriginal(originalContent);
      setApplied(true);
    } catch (err) {
      alert(`应用失败：${String(err)}`);
    } finally {
      setApplying(false);
    }
  }, [diff, applied, applying]);

  // ── 手动模式：撤回（恢复到 savedOriginal） ────────────────
  const handleRevertManual = useCallback(async () => {
    if (!applied || reverting) return;
    if (savedOriginal === null) {
      if (!window.confirm(`撤回将删除新建的文件：\n${diff.filePath}\n\n确认？`)) return;
    } else {
      if (!window.confirm(`撤回更改，恢复文件到修改前的状态：\n${diff.filePath}\n\n确认？`)) return;
    }
    setReverting(true);
    try {
      if (savedOriginal === null) {
        await invoke("delete_path", { path: diff.filePath });
      } else {
        await invoke("write_file_content", { path: diff.filePath, content: savedOriginal });
      }
      setSavedOriginal(undefined);
      setApplied(false);
    } catch (err) {
      const errMsg = String(err);
      if (errMsg.includes("不存在") || errMsg.includes("not found") || errMsg.includes("cannot find")) {
        alert(`撤回失败：文件已被删除或不可访问。\n${errMsg}`);
      } else {
        alert(`撤回失败：${errMsg}`);
      }
    } finally {
      setReverting(false);
    }
  }, [diff.filePath, applied, reverting, savedOriginal]);

  // ── 自动模式：撤回（恢复到 diff.originalContent） ─────────
  const handleRevertAuto = useCallback(async () => {
    if (reverted || reverting) return;
    const origContent = diff.originalContent;
    const isNew = origContent === null;
    const confirmMsg = isNew
      ? `撤回将删除新建的文件：\n${diff.filePath}\n\n确认？`
      : `撤回修改，恢复文件到 Agent 写入前的状态：\n${diff.filePath}\n\n确认？`;
    if (!window.confirm(confirmMsg)) return;
    setReverting(true);
    try {
      if (isNew) {
        await invoke("delete_path", { path: diff.filePath });
      } else {
        await invoke("write_file_content", { path: diff.filePath, content: origContent! });
      }
      setReverted(true);
      setConfirmed(false);
    } catch (err) {
      alert(`撤回失败：${String(err)}`);
    } finally {
      setReverting(false);
    }
  }, [diff.filePath, diff.originalContent, reverted, reverting]);

  return (
    <div
      style={{
        backgroundColor: "#0d1117",
        border: `1px solid ${reverted ? "#555" : "#30363d"}`,
        borderRadius: "6px",
        margin: "6px 0",
        overflow: "hidden",
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        fontSize: "12px",
        opacity: reverted ? 0.6 : 1,
        transition: "opacity 0.2s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          backgroundColor: "#161b22",
          borderBottom: collapsed ? "none" : "1px solid #30363d",
          cursor: "pointer",
        }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#888", fontSize: "11px" }}>{collapsed ? "▶" : "▼"}</span>
          <span style={{ color: reverted ? "#666" : "#e3b341", fontSize: "12px", textDecoration: reverted ? "line-through" : "none" }}>
            {diff.filePath}
          </span>
          <span style={{ fontSize: "11px", color: "#3fb950" }}>+{diff.addCount}</span>
          <span style={{ fontSize: "11px", color: "#f85149" }}>-{diff.removeCount}</span>
          {isAutoMode && diff.originalContent === null && (
            <span style={{ fontSize: "10px", color: "#e5a00d", backgroundColor: "rgba(229,160,13,0.1)", padding: "1px 5px", borderRadius: "3px" }}>
              新建
            </span>
          )}
          {reverted && (
            <span style={{ fontSize: "10px", color: "#888", backgroundColor: "rgba(136,136,136,0.1)", padding: "1px 5px", borderRadius: "3px" }}>
              已撤回
            </span>
          )}
        </div>
        {/* 操作按钮区 */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          {isAutoMode ? (
            // ── 自动写入模式按钮 ──────────────────────────────
            reverted ? (
              <span style={{ fontSize: "11px", color: "#666" }}>已撤回</span>
            ) : (
              <>
                {/* 撤回修改按钮 */}
                <button
                  onClick={() => void handleRevertAuto()}
                  disabled={reverting}
                  title="撤回 Agent 写入，恢复文件到修改前的内容"
                  style={{
                    padding: "2px 10px",
                    fontSize: "11px",
                    backgroundColor: reverting ? "rgba(248,81,73,0.08)" : "rgba(248,81,73,0.12)",
                    color: "#f85149",
                    border: "1px solid #f85149",
                    borderRadius: "3px",
                    cursor: reverting ? "not-allowed" : "pointer",
                    opacity: reverting ? 0.6 : 1,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!reverting) e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.22)"; }}
                  onMouseLeave={(e) => { if (!reverting) e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.12)"; }}
                >
                  {reverting ? "撤回中..." : "↩ 撤回修改"}
                </button>
                {/* 确认修改按钮 */}
                <button
                  onClick={() => setConfirmed(true)}
                  disabled={confirmed}
                  title="确认保留此次 Agent 修改"
                  style={{
                    padding: "2px 10px",
                    fontSize: "11px",
                    backgroundColor: confirmed ? "rgba(78,201,176,0.15)" : "rgba(63,185,80,0.15)",
                    color: confirmed ? "#4ec9b0" : "#3fb950",
                    border: `1px solid ${confirmed ? "#4ec9b0" : "#3fb950"}`,
                    borderRadius: "3px",
                    cursor: confirmed ? "not-allowed" : "pointer",
                  }}
                >
                  {confirmed ? "已确认 ✓" : "✓ 确认修改"}
                </button>
              </>
            )
          ) : (
            // ── 手动 diff 模式按钮（旧逻辑） ─────────────────
            <>
              {applied && (
                <button
                  onClick={() => void handleRevertManual()}
                  disabled={reverting}
                  title="撤回更改，恢复文件到修改前的内容"
                  style={{
                    padding: "2px 10px",
                    fontSize: "11px",
                    backgroundColor: reverting ? "rgba(248,81,73,0.08)" : "rgba(248,81,73,0.12)",
                    color: "#f85149",
                    border: "1px solid #f85149",
                    borderRadius: "3px",
                    cursor: reverting ? "not-allowed" : "pointer",
                    opacity: reverting ? 0.6 : 1,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!reverting) e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.22)"; }}
                  onMouseLeave={(e) => { if (!reverting) e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.12)"; }}
                >
                  {reverting ? "撤回中..." : "↩ 撤回"}
                </button>
              )}
              <button
                onClick={() => void handleApply()}
                disabled={applied || applying}
                style={{
                  padding: "2px 10px",
                  fontSize: "11px",
                  backgroundColor: applied ? "rgba(78,201,176,0.15)" : "rgba(63,185,80,0.15)",
                  color: applied ? "#4ec9b0" : "#3fb950",
                  border: `1px solid ${applied ? "#4ec9b0" : "#3fb950"}`,
                  borderRadius: "3px",
                  cursor: applied || applying ? "not-allowed" : "pointer",
                  opacity: applying ? 0.6 : 1,
                }}
              >
                {applied ? "已应用 ✓" : applying ? "应用中..." : "应用更改"}
              </button>
            </>
          )}
        </div>
      </div>
      {!collapsed && (
        <div style={{ overflowX: "auto" }}>
          {diff.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div
                style={{
                  padding: "2px 12px",
                  backgroundColor: "#1c2128",
                  color: "#8b949e",
                  fontSize: "11px",
                  borderTop: hi > 0 ? "1px solid #30363d" : "none",
                }}
              >
                {hunk.header}
              </div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  style={{
                    display: "flex",
                    backgroundColor:
                      line.type === "add" ? "rgba(63,185,80,0.1)" : line.type === "remove" ? "rgba(248,81,73,0.1)" : "transparent",
                    borderLeft: `3px solid ${line.type === "add" ? "#3fb950" : line.type === "remove" ? "#f85149" : "transparent"}`,
                  }}
                >
                  <span
                    style={{
                      width: "16px",
                      flexShrink: 0,
                      textAlign: "center",
                      color: line.type === "add" ? "#3fb950" : line.type === "remove" ? "#f85149" : "#555",
                      userSelect: "none",
                      paddingLeft: "4px",
                    }}
                  >
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  <pre
                    style={{
                      margin: 0,
                      padding: "1px 8px",
                      color: line.type === "add" ? "#aff5b4" : line.type === "remove" ? "#ffdcd7" : "#c9d1d9",
                      whiteSpace: "pre",
                      flex: 1,
                    }}
                  >
                    {line.content}
                  </pre>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── FileChangeSummaryPanel：汇总式文件变更确认面板 ─────────────────────────

/**
 * 单个文件行的变更状态
 *   pending  → 等待用户决策
 *   accepted → 用户已接受（已写入磁盘）
 *   rejected → 用户已撤销（不写入）
 */
type ChangeItemStatus = "pending" | "accepted" | "rejected" | "writing";

interface ChangeItemState {
  status: ChangeItemStatus;
  expanded: boolean;
}

interface FileChangeSummaryPanelProps {
  changes: PendingChange[];
  workspacePath: string | null;
  /** 写入成功后触发（用于刷新文件树） */
  onFileWritten?: (filePath: string) => void;
  /** 面板中所有文件都处理完后触发 */
  onAllDone?: () => void;
}

const FileChangeSummaryPanel: React.FC<FileChangeSummaryPanelProps> = ({
  changes,
  workspacePath: _wp,
  onFileWritten,
}) => {
  // 每个文件的独立状态（key = filePath）
  const [itemStates, setItemStates] = useState<Record<string, ChangeItemState>>(() => {
    const init: Record<string, ChangeItemState> = {};
    for (const c of changes) init[c.filePath] = { status: "pending", expanded: false };
    return init;
  });

  // 计算总体状态
  const allStatuses = changes.map((c) => itemStates[c.filePath]?.status ?? "pending");
  const pendingCount = allStatuses.filter((s) => s === "pending").length;
  const acceptedCount = allStatuses.filter((s) => s === "accepted").length;
  const rejectedCount = allStatuses.filter((s) => s === "rejected").length;
  const allDone = pendingCount === 0;

  // ── 辅助：写入单个文件 ────────────────────────────────────────────────────
  const writeFile = useCallback(async (change: PendingChange) => {
    setItemStates((prev) => ({
      ...prev,
      [change.filePath]: { ...prev[change.filePath], status: "writing" },
    }));
    try {
      await invoke("write_file_content", { path: change.filePath, content: change.newContent });
      // 触发文件树刷新
      onFileWritten?.(change.filePath);
      setItemStates((prev) => ({
        ...prev,
        [change.filePath]: { ...prev[change.filePath], status: "accepted" },
      }));
    } catch (err) {
      alert(`写入失败：${change.filePath}\n${String(err)}`);
      setItemStates((prev) => ({
        ...prev,
        [change.filePath]: { ...prev[change.filePath], status: "pending" },
      }));
    }
  }, [onFileWritten]);

  // ── 接受单个文件 ──────────────────────────────────────────────────────────
  const handleAccept = useCallback((change: PendingChange) => {
    void writeFile(change);
  }, [writeFile]);

  // ── 撤销单个文件 ──────────────────────────────────────────────────────────
  const handleReject = useCallback((filePath: string) => {
    setItemStates((prev) => ({
      ...prev,
      [filePath]: { ...prev[filePath], status: "rejected" },
    }));
  }, []);

  // ── 全部接受 ──────────────────────────────────────────────────────────────
  const handleAcceptAll = useCallback(async () => {
    const pending = changes.filter((c) => itemStates[c.filePath]?.status === "pending");
    for (const change of pending) {
      await writeFile(change);
    }
  }, [changes, itemStates, writeFile]);

  // ── 全部撤销 ──────────────────────────────────────────────────────────────
  const handleRejectAll = useCallback(() => {
    setItemStates((prev) => {
      const next = { ...prev };
      for (const c of changes) {
        if (next[c.filePath]?.status === "pending") {
          next[c.filePath] = { ...next[c.filePath], status: "rejected" };
        }
      }
      return next;
    });
  }, [changes]);

  // ── 切换展开/折叠 ─────────────────────────────────────────────────────────
  const toggleExpand = useCallback((filePath: string) => {
    setItemStates((prev) => ({
      ...prev,
      [filePath]: { ...prev[filePath], expanded: !prev[filePath]?.expanded },
    }));
  }, []);

  // ── 计算相对路径（用于显示） ──────────────────────────────────────────────
  const getRelativePath = useCallback((filePath: string) => {
    if (!_wp) return filePath;
    const normalized = filePath.replace(/\\/g, "/");
    const base = _wp.replace(/\\/g, "/").replace(/\/$/, "");
    return normalized.startsWith(base + "/") ? normalized.slice(base.length + 1) : normalized;
  }, [_wp]);

  return (
    <div
      style={{
        backgroundColor: "#0d1117",
        border: "1px solid #30363d",
        borderRadius: "6px",
        margin: "8px 0",
        overflow: "hidden",
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        fontSize: "12px",
      }}
    >
      {/* ── 面板头部 ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          backgroundColor: "#161b22",
          borderBottom: "1px solid #30363d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px" }}>📝</span>
          <span style={{ color: "#e3b341", fontWeight: 600, fontSize: "12px" }}>
            文件变更汇总
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "#8b949e",
              backgroundColor: "rgba(139,148,158,0.1)",
              padding: "1px 6px",
              borderRadius: "10px",
            }}
          >
            共 {changes.length} 个文件
          </span>
          {allDone && (
            <span
              style={{
                fontSize: "11px",
                color: acceptedCount > 0 ? "#3fb950" : "#8b949e",
                backgroundColor: acceptedCount > 0 ? "rgba(63,185,80,0.1)" : "rgba(139,148,158,0.1)",
                padding: "1px 6px",
                borderRadius: "10px",
              }}
            >
              {acceptedCount > 0 && `✓ 已写入 ${acceptedCount}`}
              {rejectedCount > 0 && acceptedCount > 0 && "  "}
              {rejectedCount > 0 && `✗ 已撤销 ${rejectedCount}`}
            </span>
          )}
        </div>
        {/* 批量操作按钮（只在有 pending 时显示） */}
        {!allDone && (
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => void handleAcceptAll()}
              style={{
                padding: "3px 12px",
                fontSize: "11px",
                backgroundColor: "rgba(63,185,80,0.15)",
                color: "#3fb950",
                border: "1px solid #3fb950",
                borderRadius: "4px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(63,185,80,0.25)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(63,185,80,0.15)")}
            >
              ✓ 全部接受
            </button>
            <button
              onClick={handleRejectAll}
              style={{
                padding: "3px 12px",
                fontSize: "11px",
                backgroundColor: "rgba(248,81,73,0.12)",
                color: "#f85149",
                border: "1px solid #f85149",
                borderRadius: "4px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.22)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.12)")}
            >
              ✗ 全部撤销
            </button>
          </div>
        )}
      </div>

      {/* ── 文件列表 ── */}
      {changes.map((change) => {
        const state = itemStates[change.filePath] ?? { status: "pending", expanded: false };
        const { status, expanded } = state;
        const relPath = getRelativePath(change.filePath);
        const isNew = change.isNew;

        return (
          <div
            key={change.filePath}
            style={{
              borderBottom: "1px solid #21262d",
              opacity: status === "rejected" ? 0.5 : 1,
              transition: "opacity 0.2s",
            }}
          >
            {/* 文件行 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "7px 12px",
                gap: "8px",
                cursor: "pointer",
                backgroundColor: expanded ? "rgba(255,255,255,0.02)" : "transparent",
              }}
              onClick={() => toggleExpand(change.filePath)}
            >
              {/* 展开/折叠箭头 */}
              <span style={{ color: "#555", fontSize: "10px", flexShrink: 0, width: "10px" }}>
                {expanded ? "▼" : "▶"}
              </span>

              {/* 类型标签 */}
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: "3px",
                  flexShrink: 0,
                  backgroundColor: isNew ? "rgba(63,185,80,0.18)" : "rgba(79,140,255,0.18)",
                  color: isNew ? "#3fb950" : "#4f8cff",
                  border: `1px solid ${isNew ? "rgba(63,185,80,0.4)" : "rgba(79,140,255,0.4)"}`,
                }}
              >
                {isNew ? "新增" : "修改"}
              </span>

              {/* 文件路径 */}
              <span
                style={{
                  flex: 1,
                  color: status === "rejected" ? "#555" : "#e3b341",
                  fontSize: "12px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textDecoration: status === "rejected" ? "line-through" : "none",
                }}
                title={change.filePath}
              >
                {relPath}
              </span>

              {/* 行数统计 */}
              <span style={{ color: "#3fb950", fontSize: "11px", flexShrink: 0 }}>
                +{change.diff.addCount}
              </span>
              <span style={{ color: "#f85149", fontSize: "11px", flexShrink: 0 }}>
                -{change.diff.removeCount}
              </span>

              {/* 状态/操作按钮区 */}
              <div
                style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                {status === "writing" && (
                  <span style={{ fontSize: "11px", color: "#e5a00d" }}>写入中...</span>
                )}
                {status === "accepted" && (
                  <span style={{ fontSize: "11px", color: "#3fb950" }}>✓ 已写入</span>
                )}
                {status === "rejected" && (
                  <span style={{ fontSize: "11px", color: "#555" }}>✗ 已撤销</span>
                )}
                {status === "pending" && (
                  <>
                    <button
                      onClick={() => handleAccept(change)}
                      style={{
                        padding: "2px 9px",
                        fontSize: "11px",
                        backgroundColor: "rgba(63,185,80,0.15)",
                        color: "#3fb950",
                        border: "1px solid #3fb950",
                        borderRadius: "3px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(63,185,80,0.28)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(63,185,80,0.15)")}
                    >
                      接受
                    </button>
                    <button
                      onClick={() => handleReject(change.filePath)}
                      style={{
                        padding: "2px 9px",
                        fontSize: "11px",
                        backgroundColor: "rgba(248,81,73,0.12)",
                        color: "#f85149",
                        border: "1px solid #f85149",
                        borderRadius: "3px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.22)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,81,73,0.12)")}
                    >
                      撤销
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 展开后的内联 Diff */}
            {expanded && (
              <div style={{ borderTop: "1px solid #21262d", overflowX: "auto" }}>
                {change.diff.hunks.length === 0 ? (
                  <div style={{ padding: "8px 16px", color: "#555", fontSize: "11px" }}>
                    无差异内容
                  </div>
                ) : (
                  change.diff.hunks.map((hunk, hi) => (
                    <div key={hi}>
                      <div
                        style={{
                          padding: "2px 12px",
                          backgroundColor: "#1c2128",
                          color: "#8b949e",
                          fontSize: "11px",
                          borderTop: hi > 0 ? "1px solid #30363d" : "none",
                        }}
                      >
                        {hunk.header}
                      </div>
                      {hunk.lines.map((line, li) => (
                        <div
                          key={li}
                          style={{
                            display: "flex",
                            backgroundColor:
                              line.type === "add"
                                ? "rgba(63,185,80,0.1)"
                                : line.type === "remove"
                                ? "rgba(248,81,73,0.1)"
                                : "transparent",
                            borderLeft: `3px solid ${
                              line.type === "add"
                                ? "#3fb950"
                                : line.type === "remove"
                                ? "#f85149"
                                : "transparent"
                            }`,
                          }}
                        >
                          {/* 行号 */}
                          <span
                            style={{
                              width: "36px",
                              flexShrink: 0,
                              textAlign: "right",
                              color: "#555",
                              userSelect: "none",
                              paddingRight: "6px",
                              fontSize: "10px",
                              lineHeight: "20px",
                            }}
                          >
                            {line.type !== "add" && (line.oldLineNo ?? "")}
                          </span>
                          <span
                            style={{
                              width: "36px",
                              flexShrink: 0,
                              textAlign: "right",
                              color: "#555",
                              userSelect: "none",
                              paddingRight: "6px",
                              fontSize: "10px",
                              lineHeight: "20px",
                            }}
                          >
                            {line.type !== "remove" && (line.newLineNo ?? "")}
                          </span>
                          {/* 符号列 */}
                          <span
                            style={{
                              width: "16px",
                              flexShrink: 0,
                              textAlign: "center",
                              color:
                                line.type === "add"
                                  ? "#3fb950"
                                  : line.type === "remove"
                                  ? "#f85149"
                                  : "#555",
                              userSelect: "none",
                            }}
                          >
                            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                          </span>
                          <pre
                            style={{
                              margin: 0,
                              padding: "1px 8px",
                              color:
                                line.type === "add"
                                  ? "#aff5b4"
                                  : line.type === "remove"
                                  ? "#ffdcd7"
                                  : "#c9d1d9",
                              whiteSpace: "pre",
                              flex: 1,
                              fontSize: "12px",
                              lineHeight: "20px",
                            }}
                          >
                            {line.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── ChatPanel 组件 ──────────────────────────────────────────────────────────

const ChatPanel: React.FC<ChatPanelProps> = ({ aiSettings, activeTab, workspacePath, pendingChatCommand, onClearPendingCommand }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const abortAgentRef = useRef(false);
  const writtenFilesRef = useRef<string[]>([]);
  /** Agent 执行阶段的暂存文件变更（写入前先存这里，任务结束后统一展示确认面板） */
  const pendingChangesRef = useRef<Map<string, PendingChange>>(new Map());
  const [expandedOpen, setExpandedOpen] = useState(false);

  // ── 命令菜单状态 ───────────────────────────────────────────────────────────
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [commandSelectedIdx, setCommandSelectedIdx] = useState(0);

  // ── 输入历史记录 Hook ──────────────────────────────────────────────────────
  const { history: inputHistory, pushHistory, navigateUp, navigateDown, resetNavigation } = useInputHistory();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLTextAreaElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    };
  }, []);

  // ── 输入框内容变化：同步命令菜单 ─────────────────────────────────────────
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    // 只要手动输入就重置历史导航（由 onChange 触发，非历史导航触发）
    // 注意：历史导航通过直接 setInput 调用，不会走这里
    if (value.startsWith("/")) {
      const cmds = filterCommands(value);
      setFilteredCommands(cmds);
      setCommandMenuOpen(cmds.length > 0);
      setCommandSelectedIdx(0);
    } else {
      setCommandMenuOpen(false);
      setFilteredCommands([]);
    }
  }, []);

  const buildSystemPrompt = useCallback((): string => {
    let prompt = "你是 AQingIDE 内置的 AI 编程助手，擅长代码分析、调试、重构和解释。请用中文回答，代码部分使用代码块格式。";
    if (activeTab) prompt += `\n\n当前打开的文件：${activeTab.path}\n编程语言：${activeTab.language}`;
    return prompt;
  }, [activeTab]);

  useEffect(() => {
    if (!pendingChatCommand) return;
    const desc = SLASH_COMMAND_PROMPTS[pendingChatCommand.command];
    const message = `${desc}\n\n\`\`\`${pendingChatCommand.language}\n${pendingChatCommand.code}\n\`\`\``;
    setInput(message);
    onClearPendingCommand?.();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [pendingChatCommand]);

  // ── 消息列表辅助 ──────────────────────────────────────────────────────────

  const appendMessage = useCallback((msg: Omit<ChatMessage, "id" | "timestamp"> & { timestamp?: number }): string => {
    const id = generateId();
    setMessages((prev) => [...prev, { ...msg, id, timestamp: msg.timestamp ?? Date.now() }]);
    return id;
  }, []);

  const finalizeMessage = useCallback((id: string, content: string, opts?: { isToolCall?: boolean; isToolResult?: boolean; error?: string; diffs?: FileDiff[]; pendingChanges?: PendingChange[] }) => {
    setMessages((prev) =>
      prev.map((m) => m.id === id ? { ...m, content, isStreaming: false, ...opts } : m)
    );
  }, []);

  // ── 任务计划确认/取消 ─────────────────────────────────────────────────────

  const handleConfirmPlan = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => m.id === msgId && m.taskPlan ? { ...m, taskPlan: { ...m.taskPlan, state: "confirmed" } } : m)
    );
  }, []);

  const handleCancelPlan = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => m.id === msgId && m.taskPlan ? { ...m, taskPlan: { ...m.taskPlan, state: "cancelled" } } : m)
    );
  }, []);

  // ── 普通 Chat 发送 ────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || agentRunning) return;

    // ── 关闭命令菜单 ────────────────────────────────────────────────────────
    setCommandMenuOpen(false);
    resetNavigation();

    // ── 处理内置命令 ────────────────────────────────────────────────────────
    const builtinCmd = matchBuiltinCommand(text);
    if (builtinCmd) {
      setInput("");
      if (builtinCmd.name === "/history") {
        // 显示历史面板（作为系统消息插入对话区）
        const id = generateId();
        setMessages((prev) => [
          ...prev,
          {
            id,
            role: "system",
            content: "",
            timestamp: Date.now(),
            isHistoryPanel: true,
          },
        ]);
      }
      return;
    }

    const cfg = aiSettings.getActiveProviderConfig();
    if (!cfg.enabled || !cfg.apiKey) {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "assistant", content: "请先在设置中配置并启用 AI 提供商（点击左下角设置图标）。", error: "未配置", timestamp: Date.now() },
      ]);
      return;
    }

    // ── 存入历史记录 ────────────────────────────────────────────────────────
    pushHistory(text);

    if (agentMode) { setInput(""); await runAgentLoop(text, cfg); return; }

    const userMsg: ChatMessage = { id: generateId(), role: "user", content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const assistantMsgId = generateId();
    setMessages((prev) => [...prev, { id: assistantMsgId, role: "assistant", content: "", isStreaming: true, timestamp: Date.now() }]);

    const requestId = generateId();
    currentRequestIdRef.current = requestId;

    // 所有请求统一注入任务规划指令，让 AI 先输出任务计划再逐步实现
    const systemPrompt = buildSystemPrompt() +
      "\n\n对于每个用户请求，请先输出一个简洁的任务计划，格式如下：\n## 任务计划\n1. 子任务一\n2. 子任务二\n（根据需求列出2-5个步骤，简单问题也要列出步骤）\n然后再逐步实现每个子任务，给出详细的代码和说明。";
    const historyMessages = [
      { role: "system", content: systemPrompt },
      ...messages.filter((m) => m.role !== "system" && !m.error).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    const eventName = `ai-stream-${requestId}`;
    if (unlistenRef.current) unlistenRef.current();

    unlistenRef.current = await listen<AiStreamEvent>(eventName, (event) => {
      const payload = event.payload;
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

      if (payload.error) {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantMsgId ? { ...m, isStreaming: false, error: payload.error, content: `错误：${payload.error}` } : m)
        );
        setIsLoading(false);
        return;
      }
      if (payload.done) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsgId) return m;
            const diffs = parseDiff(m.content);
            const taskPlan = parseTaskPlan(m.content);
            return { ...m, isStreaming: false, diffs: diffs.length > 0 ? diffs : undefined, taskPlan: taskPlan ?? undefined };
          })
        );
        setIsLoading(false);
        return;
      }
      if (payload.delta) {
        setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: m.content + payload.delta } : m));
      }
    });

    timeoutRef.current = setTimeout(() => {
      if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, isStreaming: false, error: "timeout", content: m.content || "请求超时（60s），请检查网络或 API Key 是否正确。" }
            : m
        )
      );
      setIsLoading(false);
    }, 60000);

    try {
      await invoke("ai_chat_stream", {
        request: {
          provider: cfg.provider, api_key: cfg.apiKey, base_url: cfg.baseUrl ?? null,
          model: cfg.chatModel, messages: historyMessages, stream: true, max_tokens: 4096, temperature: 0.7,
        },
        requestId,
      });
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => m.id === assistantMsgId ? { ...m, isStreaming: false, error: String(err), content: `请求失败：${err}` } : m)
      );
      setIsLoading(false);
    }
  }, [input, isLoading, agentRunning, agentMode, messages, aiSettings, buildSystemPrompt, pushHistory, resetNavigation]);

  // ── Agent 工具执行 ────────────────────────────────────────────────────────

  /** 工具执行结果：result 为返回给 AI 的文字（write_file 不再返回 diff，改为暂存） */
  const executeAgentTool = useCallback(async (name: string, args: Record<string, string>): Promise<{ result: string; diff?: FileDiff }> => {
    switch (name) {
      case "read_file": {
        const content = await invoke<string>("read_file_content", { path: args.path });
        return { result: content.slice(0, 8000) };
      }
      case "write_file": {
        let filePath = args.path;
        const isAbsolute = /^([A-Za-z]:[/\\]|\/)/.test(filePath);
        if (!isAbsolute) { const base = workspacePath ?? "."; filePath = `${base}/${filePath}`.replace(/\\/g, "/"); }

        // ── 暂存阶段：不立即写磁盘，读取旧内容后存入 pendingChangesRef ──────
        let oldContent: string | null = null;
        try {
          oldContent = await invoke<string>("read_file_content", { path: filePath });
        } catch {
          oldContent = null; // 新建文件
        }

        const newContent = args.content;
        const isNew = oldContent === null;

        // 如果同一文件本轮被重复写入，保留最早的 oldContent（用于最终撤回）
        const existing = pendingChangesRef.current.get(filePath);
        const baseOldContent = existing ? existing.oldContent : oldContent;

        const diff = computeLineDiff(filePath, baseOldContent, newContent);
        diff.originalContent = baseOldContent;
        diff.isAutoWritten = true;

        pendingChangesRef.current.set(filePath, {
          filePath,
          oldContent: baseOldContent,
          newContent,
          isNew: existing ? existing.isNew : isNew,
          diff,
        });

        return { result: `文件已暂存（待确认写入）：${filePath}` };
      }
      case "list_directory": {
        const nodes = await invoke<Array<{ name: string; is_dir: boolean }>>("read_directory", { path: args.path });
        return { result: nodes.map((n) => `${n.is_dir ? "[目录]" : "[文件]"} ${n.name}`).join("\n") };
      }
      case "execute_command": {
        const ok = window.confirm(`Agent 要执行命令：\n${args.command}\n\n确认允许？`);
        if (!ok) return { result: "用户拒绝了命令执行" };
        const termId = "agent-terminal";
        let output = "";
        const unlisten = await listen<{ terminal_id: string; data: string; is_stderr: boolean; exit_code: number | null }>(
          `terminal-output-${termId}`,
          (event) => { if (event.payload.data) output += event.payload.data; }
        );
        await invoke("terminal_execute", { terminalId: termId, command: args.command, cwd: args.cwd ?? "." });
        await new Promise<void>((r) => setTimeout(r, 2000));
        unlisten();
        return { result: output || "(无输出)" };
      }
      default: return { result: `未知工具: ${name}` };
    }
  }, [workspacePath]);

  // ── Agent 循环 ────────────────────────────────────────────────────────────

  const runAgentLoop = useCallback(async (
    userMessage: string,
    cfg: ReturnType<typeof aiSettings.getActiveProviderConfig>
  ) => {
    if (cfg.provider === "anthropic") {
      appendMessage({ role: "assistant", content: "Agent 模式暂不支持 Anthropic 协议，请切换到 OpenAI / DashScope / Custom 提供商。", error: "不支持" });
      return;
    }

    setAgentRunning(true);
    abortAgentRef.current = false;
    writtenFilesRef.current = [];
    // 清空上次残留的暂存变更
    pendingChangesRef.current = new Map();
    appendMessage({ role: "user", content: userMessage });

    const defaultSaveDir = workspacePath ?? ".";
    const agentMessages: AgentMessage[] = [
      {
        role: "system",
        content: `你是一个 AI 编程助手，可以使用工具读写文件、执行命令来完成任务。每次只调用必要的工具，完成后给出总结。\n默认文件保存目录：${defaultSaveDir}`,
      },
      ...messages
        .filter((m) => m.role !== "system" && !m.error && !m.isToolCall && !m.isToolResult)
        .map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    const MAX_STEPS = 10;
    let stepCount = 0;
    /** 最终消息的 id（用于结束后附加 pendingChanges） */
    let finalMsgId: string | null = null;

    while (stepCount < MAX_STEPS && !abortAgentRef.current) {
      stepCount++;
      const thinkingId = appendMessage({ role: "assistant", content: "", isStreaming: true });

      try {
        const response = await invoke<AgentStepResponse>("ai_agent_step", {
          provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl ?? null,
          model: cfg.chatModel, messages: agentMessages, tools: AGENT_TOOLS,
        });

        if (abortAgentRef.current) { finalizeMessage(thinkingId, "已被用户中断"); break; }

        if (response.tool_calls.length === 0) {
          // ── 最终回复：将暂存变更列表附加到此消息 ────────────────────────
          const manualDiffs = parseDiff(response.content ?? "");
          const sessionPending = Array.from(pendingChangesRef.current.values());
          finalizeMessage(thinkingId, response.content ?? "(无回复)", {
            diffs: manualDiffs.length > 0 ? manualDiffs : undefined,
            pendingChanges: sessionPending.length > 0 ? sessionPending : undefined,
          });
          finalMsgId = thinkingId;
          // 暂存 map 保留，等用户操作后由 FileChangeSummaryPanel 处理
          break;
        }

        const toolCallSummary = response.tool_calls.map((tc) => `调用工具：${tc.name}\n参数：\`${tc.arguments}\``).join("\n\n");
        finalizeMessage(thinkingId, toolCallSummary, { isToolCall: true });

        agentMessages.push({
          role: "assistant",
          content: response.content ?? null,
          tool_calls: response.tool_calls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
        });

        for (const toolCall of response.tool_calls) {
          if (abortAgentRef.current) break;
          let args: Record<string, string> = {};
          try { args = JSON.parse(toolCall.arguments) as Record<string, string>; } catch { /* ignore */ }
          const resultId = appendMessage({ role: "tool", content: "", isStreaming: true });
          try {
            const { result } = await executeAgentTool(toolCall.name, args);
            // write_file 已改为暂存，工具结果气泡只显示简单文字提示
            finalizeMessage(resultId, `${toolCall.name} 结果：\n\`\`\`\n${result.slice(0, 2000)}\n\`\`\``, { isToolResult: true });
            agentMessages.push({ role: "tool", content: result, tool_call_id: toolCall.id, name: toolCall.name });
          } catch (err) {
            finalizeMessage(resultId, `${toolCall.name} 失败：${String(err)}`, { isToolResult: true, error: String(err) });
            agentMessages.push({ role: "tool", content: String(err), tool_call_id: toolCall.id, name: toolCall.name });
          }
        }
      } catch (err) {
        finalizeMessage(thinkingId, `Agent 步骤失败：${String(err)}`, { error: String(err) });
        break;
      }
    }

    if (stepCount >= MAX_STEPS && !abortAgentRef.current) {
      // 超出步骤数时也把暂存变更附到最后一条消息
      const sessionPending = Array.from(pendingChangesRef.current.values());
      if (sessionPending.length > 0 && finalMsgId === null) {
        appendMessage({
          role: "assistant",
          content: "Agent 已达到最大步骤数（10步），任务终止。",
          pendingChanges: sessionPending,
        });
      } else {
        appendMessage({ role: "assistant", content: "Agent 已达到最大步骤数（10步），任务终止。" });
      }
    }

    setAgentRunning(false);
  }, [messages, aiSettings, appendMessage, finalizeMessage, executeAgentTool, workspacePath]);

  const handleClear = useCallback(() => { if (isLoading || agentRunning) return; setMessages([]); }, [isLoading, agentRunning]);
  const handleStopAgent = useCallback(() => { abortAgentRef.current = true; }, []);

  const cfg = aiSettings.getActiveProviderConfig();
  const isConfigured = cfg.enabled && cfg.apiKey;
  const isAnthropicActive = cfg.provider === "anthropic";
  const busy = isLoading || agentRunning;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#252526", borderLeft: "1px solid #1e1e1e", overflow: "hidden" }}>
      {/* 标题栏 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#bbbbbb", textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Chat</span>
          {isConfigured && (
            <span style={{ fontSize: "10px", color: "#4ec9b0", backgroundColor: "rgba(78,201,176,0.1)", padding: "1px 6px", borderRadius: "3px" }}>
              {cfg.chatModel}
            </span>
          )}
          <button
            onClick={() => !busy && setAgentMode((v) => !v)}
            disabled={busy}
            title={isAnthropicActive ? "Agent 模式不支持 Anthropic 协议" : (agentMode ? "关闭 Agent 模式" : "开启 Agent 模式")}
            style={{
              fontSize: "10px", padding: "1px 7px", borderRadius: "3px",
              border: `1px solid ${agentMode ? "#e5a00d" : "#555"}`,
              backgroundColor: agentMode ? "rgba(229,160,13,0.15)" : "transparent",
              color: agentMode ? "#e5a00d" : "#666",
              cursor: busy || isAnthropicActive ? "not-allowed" : "pointer",
              opacity: isAnthropicActive ? 0.4 : 1, transition: "all 0.15s",
            }}
          >
            Agent
          </button>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {agentRunning && (
            <button onClick={handleStopAgent} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "3px", border: "1px solid #f48771", backgroundColor: "rgba(244,135,113,0.12)", color: "#f48771", cursor: "pointer" }}>
              停止
            </button>
          )}
          <button
            onClick={handleClear}
            disabled={busy || messages.length === 0}
            style={{ background: "none", border: "none", color: messages.length === 0 ? "#444" : "#888", cursor: messages.length === 0 ? "default" : "pointer", fontSize: "12px", padding: "2px 6px", borderRadius: "3px" }}
          >
            清空
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", display: "flex", flexDirection: "column", gap: "2px" }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#555", fontSize: "12px", textAlign: "center", padding: "0 20px", gap: "8px" }}>
            {isConfigured ? (
              <>
                <div style={{ fontSize: "28px", opacity: 0.3 }}>{agentMode ? "🤖" : "💬"}</div>
                <p>{agentMode ? "Agent 模式：AI 可自主调用工具完成任务" : "开始与 AI 对话"}</p>
                {activeTab && <p style={{ fontSize: "11px", opacity: 0.6 }}>当前文件：{activeTab.name}</p>}
              </>
            ) : (
              <>
                <div style={{ fontSize: "28px", opacity: 0.3 }}>⚙</div>
                <p>请先配置 AI 提供商</p>
                <p style={{ fontSize: "11px", opacity: 0.6 }}>点击左下角设置图标配置 API Key</p>
              </>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            workspacePath={workspacePath}
            onConfirmPlan={() => handleConfirmPlan(msg.id)}
            onCancelPlan={() => handleCancelPlan(msg.id)}
            inputHistory={inputHistory}
            onUseHistory={(content) => {
              // 填充到输入框，关闭面板，光标移末尾
              setInput(content);
              setCommandMenuOpen(false);
              resetNavigation();
              // 移除该历史面板消息
              setMessages((prev) => prev.filter((m) => m.id !== msg.id));
              setTimeout(() => {
                const el = inputRef.current;
                if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
              }, 0);
            }}
            onDismissHistory={() => {
              setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            }}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid #1e1e1e", flexShrink: 0, backgroundColor: "#252526" }}>
        {agentMode ? (
          <div style={{ fontSize: "10px", color: "#e5a00d", marginBottom: "5px", opacity: 0.8 }}>Agent 模式 — AI 将自主调用工具完成任务</div>
        ) : activeTab ? (
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            上下文：{activeTab.name} ({activeTab.language})
          </div>
        ) : null}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            {/* 命令下拉菜单（浮层，出现在输入框上方） */}
            {commandMenuOpen && (
              <CommandMenu
                commands={filteredCommands}
                selectedIndex={commandSelectedIdx}
                onSelect={(cmd) => {
                  setCommandMenuOpen(false);
                  resetNavigation();
                  setInput("");
                  // 直接执行内置命令
                  if (cmd.name === "/history") {
                    const id = generateId();
                    setMessages((prev) => [
                      ...prev,
                      { id, role: "system", content: "", timestamp: Date.now(), isHistoryPanel: true },
                    ]);
                  }
                  setTimeout(() => {
                    const el = inputRef.current;
                    if (el) el.focus();
                  }, 0);
                }}
              />
            )}
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                handleInputChange(e.target.value);
                resetNavigation();
              }}
              onKeyDown={(e) => {
                // ── ESC：关闭命令菜单 ─────────────────────────────────────
                if (e.key === "Escape") {
                  if (commandMenuOpen) {
                    e.preventDefault();
                    setCommandMenuOpen(false);
                    return;
                  }
                }

                // ── ↑ / ↓ 键：命令菜单导航优先，其次历史导航 ─────────────
                if (e.key === "ArrowUp") {
                  if (commandMenuOpen) {
                    e.preventDefault();
                    setCommandSelectedIdx((v) => Math.max(0, v - 1));
                    return;
                  }
                  // 历史导航
                  e.preventDefault();
                  const filled = navigateUp(input);
                  if (filled !== null) {
                    setInput(filled);
                    setCommandMenuOpen(false);
                    // 光标移到末尾（异步，等 React 更新后）
                    setTimeout(() => {
                      const el = inputRef.current;
                      if (el) { el.setSelectionRange(el.value.length, el.value.length); }
                    }, 0);
                  }
                  return;
                }

                if (e.key === "ArrowDown") {
                  if (commandMenuOpen) {
                    e.preventDefault();
                    setCommandSelectedIdx((v) => Math.min(filteredCommands.length - 1, v + 1));
                    return;
                  }
                  // 历史导航（向后翻）
                  const filled = navigateDown();
                  if (filled !== null) {
                    e.preventDefault();
                    setInput(filled);
                    setCommandMenuOpen(false);
                    setTimeout(() => {
                      const el = inputRef.current;
                      if (el) { el.setSelectionRange(el.value.length, el.value.length); }
                    }, 0);
                  }
                  return;
                }

                // ── Enter：命令菜单中选择执行选中命令，否则发送 ─────────────
                if (e.key === "Enter" && !e.shiftKey) {
                  if (commandMenuOpen && filteredCommands.length > 0) {
                    e.preventDefault();
                    const selected = filteredCommands[commandSelectedIdx];
                    if (selected) {
                      // 直接执行内置命令，无需走 setInput → handleSend 异步链
                      setCommandMenuOpen(false);
                      resetNavigation();
                      setInput("");
                      if (selected.name === "/history") {
                        const id = generateId();
                        setMessages((prev) => [
                          ...prev,
                          { id, role: "system", content: "", timestamp: Date.now(), isHistoryPanel: true },
                        ]);
                      }
                    }
                    return;
                  }
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={!isConfigured ? "请先配置 AI 提供商" : agentMode ? "描述任务..." : "输入消息... (/ 开头使用命令，↑↓ 浏览历史)"}
              disabled={busy || !isConfigured}
              style={{
                width: "100%", boxSizing: "border-box", backgroundColor: "#3c3c3c", color: "#cccccc",
                fontSize: "13px", padding: "5px 26px 5px 8px", borderRadius: "4px",
                border: `1px solid ${agentMode ? "#6b4f00" : "#484848"}`, outline: "none",
                fontFamily: "inherit", lineHeight: "20px", height: "30px", opacity: !isConfigured ? 0.5 : 1,
              }}
            />
            <button
              onClick={() => setExpandedOpen(true)}
              title="展开输入框"
              style={{ position: "absolute", top: "50%", right: "4px", transform: "translateY(-50%)", background: "none", border: "none", color: "#555", cursor: "pointer", padding: "0 2px", lineHeight: 1, fontSize: "11px", borderRadius: "2px" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#aaa")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
            >
              ⤢
            </button>
          </div>
          <button
            onClick={() => void handleSend()}
            disabled={busy || !input.trim() || !isConfigured}
            style={{
              padding: "0 12px", height: "30px", backgroundColor: agentMode ? "#7a5500" : "#007acc",
              color: "white", fontSize: "12px", borderRadius: "4px", border: "none",
              cursor: busy || !input.trim() || !isConfigured ? "not-allowed" : "pointer",
              opacity: busy || !input.trim() || !isConfigured ? 0.5 : 1, flexShrink: 0, whiteSpace: "nowrap",
            }}
          >
            {agentRunning ? "运行中" : isLoading ? "..." : agentMode ? "执行" : "发送"}
          </button>
        </div>
      </div>

      {expandedOpen && (
        <ExpandedInputModal
          value={input}
          onChange={setInput}
          onClose={() => { setExpandedOpen(false); setTimeout(() => inputRef.current?.focus(), 50); }}
          onSend={() => { setExpandedOpen(false); setTimeout(() => void handleSend(), 50); }}
          agentMode={agentMode}
          disabled={busy || !isConfigured}
          expandedInputRef={expandedInputRef}
        />
      )}
    </div>
  );
};

// ─── 展开输入框弹窗 ──────────────────────────────────────────────────────────

interface ExpandedInputModalProps {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSend: () => void;
  agentMode: boolean;
  disabled: boolean;
  expandedInputRef: React.RefObject<HTMLTextAreaElement | null>;
}

const ExpandedInputModal: React.FC<ExpandedInputModalProps> = ({ value, onChange, onClose, onSend, agentMode, disabled, expandedInputRef }) => {
  useEffect(() => {
    const el = expandedInputRef.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [expandedInputRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
    >
      <div style={{ width: "min(680px, 90vw)", backgroundColor: "#252526", borderRadius: "8px", border: "1px solid #3c3c3c", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
          <span style={{ fontSize: "12px", color: "#888", fontWeight: 500 }}>
            {agentMode ? "Agent 任务描述" : "输入消息"}
            <span style={{ marginLeft: "10px", fontSize: "11px", color: "#555" }}>Ctrl+Enter 发送 · Esc 关闭</span>
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px 4px", borderRadius: "3px" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ccc")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
          >
            ×
          </button>
        </div>
        <textarea
          ref={expandedInputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={agentMode ? "描述你希望 Agent 完成的任务..." : "输入消息..."}
          style={{ width: "100%", boxSizing: "border-box", minHeight: "240px", maxHeight: "60vh", backgroundColor: "#2d2d2d", color: "#cccccc", fontSize: "13px", padding: "12px 14px", border: "none", outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "10px 14px", borderTop: "1px solid #1e1e1e", flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ padding: "5px 14px", backgroundColor: "transparent", color: "#888", fontSize: "12px", borderRadius: "4px", border: "1px solid #484848", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#666")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#484848")}
          >
            取消
          </button>
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            style={{ padding: "5px 16px", backgroundColor: agentMode ? "#7a5500" : "#007acc", color: "white", fontSize: "12px", borderRadius: "4px", border: "none", cursor: disabled || !value.trim() ? "not-allowed" : "pointer", opacity: disabled || !value.trim() ? 0.5 : 1 }}
          >
            {agentMode ? "执行任务" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── 消息气泡组件 ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  workspacePath: string | null;
  onConfirmPlan: () => void;
  onCancelPlan: () => void;
  /** 历史面板：使用历史条目时的回调 */
  onUseHistory?: (content: string) => void;
  /** 历史面板：关闭面板时的回调 */
  onDismissHistory?: () => void;
  /** 历史面板的历史数据 */
  inputHistory?: InputHistoryItem[];
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  workspacePath,
  onConfirmPlan,
  onCancelPlan,
  onUseHistory,
  onDismissHistory,
  inputHistory = [],
}) => {
  const isUser = message.role === "user";
  const isToolCall = message.isToolCall === true;
  const isToolResult = message.isToolResult === true;
  const isHistoryPanel = message.isHistoryPanel === true;

  /** 批量操作计数器：每次递增触发对应 DiffBlock 执行操作 */
  const [batchConfirmTick, setBatchConfirmTick] = useState(0);
  const [batchRevertTick, setBatchRevertTick] = useState(0);

  // ── 历史面板：独立样式渲染 ──────────────────────────────────────────────
  if (isHistoryPanel) {
    return (
      <div style={{ padding: "8px 12px" }}>
        <HistoryPanel
          history={inputHistory}
          onUse={onUseHistory ?? (() => {})}
          onDismiss={onDismissHistory ?? (() => {})}
        />
      </div>
    );
  }

  let borderColor = "transparent";
  let bgColor = "transparent";
  let labelColor = "#4ec9b0";
  let label = "AI";

  if (isUser) {
    borderColor = "#007acc"; bgColor = "rgba(0,122,204,0.08)"; labelColor = "#007acc"; label = "你";
  } else if (isToolCall) {
    borderColor = "#e5a00d"; bgColor = "rgba(229,160,13,0.06)"; labelColor = "#e5a00d"; label = "工具调用";
  } else if (isToolResult) {
    borderColor = "#6a9955"; bgColor = "rgba(106,153,85,0.06)"; labelColor = "#6a9955"; label = "工具结果";
  }

  // 统计：手动 diff 中的自动写入条目 + pendingChanges 条目（用于 TaskPlanCard 批量按钮）
  const autoDiffCount = (message.diffs ?? []).filter((d) => d.isAutoWritten).length
    + (message.pendingChanges?.length ?? 0);

  return (
    <div
      style={{
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        backgroundColor: bgColor,
        borderLeft: `2px solid ${borderColor}`,
      }}
    >
      {/* 标签行 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "10px", fontWeight: 600, color: labelColor, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: "6px" }}>
          {label}
          {message.isStreaming && (
            <span style={{ opacity: 0.6 }}><StreamingDots /></span>
          )}
        </div>
        {/* 时间戳（用户消息右对齐，AI 消息左对齐通过 flex 实现） */}
        {isUser && (
          <span
            title={formatFullTime(message.timestamp)}
            style={{ fontSize: "10px", color: "#555", cursor: "default", userSelect: "none" }}
          >
            {formatTime(message.timestamp)}
          </span>
        )}
      </div>

      {/* 消息内容 */}
      <div style={{ fontSize: "13px", color: message.error ? "#f48771" : "#cccccc", lineHeight: 1.6 }}>
        {/* 用户消息和工具消息不需要 think 解析 */}
        {isUser || isToolCall || isToolResult
          ? renderContent(message.content)
          : renderContentWithThink(message.content, message.isStreaming === true)}
        {message.isStreaming && message.content === "" && (
          <span style={{ color: "#555" }}>思考中...</span>
        )}
      </div>

      {/* 任务计划卡片 */}
      {message.taskPlan && (
        <TaskPlanCard
          plan={message.taskPlan}
          onConfirm={onConfirmPlan}
          onCancel={onCancelPlan}
          diffCount={autoDiffCount}
          onBatchConfirm={autoDiffCount > 0 ? () => setBatchConfirmTick((v) => v + 1) : undefined}
          onBatchRevert={autoDiffCount > 0 ? () => setBatchRevertTick((v) => v + 1) : undefined}
        />
      )}

      {/* Diff 块（手动 diff 模式 / 旧逻辑保留） */}
      {message.diffs && message.diffs.length > 0 && (
        <div>
          {message.diffs.map((diff, i) => (
            <DiffBlock
              key={i}
              diff={diff}
              workspacePath={workspacePath}
              batchConfirmTick={diff.isAutoWritten ? batchConfirmTick : 0}
              batchRevertTick={diff.isAutoWritten ? batchRevertTick : 0}
            />
          ))}
        </div>
      )}

      {/* 汇总式文件变更确认面板（Agent 模式完成后展示） */}
      {message.pendingChanges && message.pendingChanges.length > 0 && (
        <FileChangeSummaryPanel
          changes={message.pendingChanges}
          workspacePath={workspacePath}
        />
      )}

      {/* AI 消息时间戳（左下角） */}
      {!isUser && (
        <span
          title={formatFullTime(message.timestamp)}
          style={{ fontSize: "10px", color: "#444", cursor: "default", userSelect: "none", alignSelf: "flex-start" }}
        >
          {formatTime(message.timestamp)}
        </span>
      )}
    </div>
  );
};

// 流式加载动画
const StreamingDots: React.FC = () => {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const timer = setInterval(() => { setDots((d) => (d.length >= 3 ? "." : d + ".")); }, 400);
    return () => clearInterval(timer);
  }, []);
  return <span>{dots}</span>;
};

export default ChatPanel;

