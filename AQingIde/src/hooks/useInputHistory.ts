import { useState, useCallback, useRef } from "react";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface InputHistoryItem {
  content: string;
  timestamp: number;
}

const STORAGE_KEY = "chat-input-history";
const MAX_HISTORY = 100;

// ─── localStorage 工具 ───────────────────────────────────────────────────────

function loadHistory(): InputHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as InputHistoryItem[]).filter(
      (item) =>
        item &&
        typeof item.content === "string" &&
        typeof item.timestamp === "number"
    );
  } catch {
    return [];
  }
}

function saveHistory(history: InputHistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // 忽略存储错误（如隐私模式）
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseInputHistoryReturn {
  /** 当前历史记录列表（最新在前） */
  history: InputHistoryItem[];
  /**
   * 成功发送后调用，将消息追加到历史记录。
   * - 连续相同内容不重复存入（去重：移除旧条，将新时间戳条插到最前）
   * - 超出 100 条时删除最旧的
   */
  pushHistory: (content: string) => void;
  /**
   * 键盘 ↑ 事件处理：向前翻历史。
   * @param currentInput 当前输入框内容
   * @returns 要填充到输入框的内容（null 表示不改变）
   */
  navigateUp: (currentInput: string) => string | null;
  /**
   * 键盘 ↓ 事件处理：向后翻历史。
   * @returns 要填充到输入框的内容（null 表示不改变）
   */
  navigateDown: () => string | null;
  /** 重置历史导航状态（输入框内容手动修改时调用，或发送后调用） */
  resetNavigation: () => void;
  /** 是否正在浏览历史（用于 ↑↓ 键是否拦截默认行为） */
  isBrowsing: boolean;
}

export function useInputHistory(): UseInputHistoryReturn {
  const [history, setHistory] = useState<InputHistoryItem[]>(() => loadHistory());

  /**
   * 历史导航状态：
   *  -1 = 未进入历史模式（正常输入）
   *  0  = 浏览最新一条（history[0]）
   *  1  = 浏览第二条（history[1]）
   *  ... 以此类推
   */
  const historyIndexRef = useRef<number>(-1);
  /** 进入历史模式前的草稿内容 */
  const draftRef = useRef<string>("");

  const isBrowsing = historyIndexRef.current >= 0;

  const pushHistory = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    setHistory((prev) => {
      // 去重：如果已存在相同内容，移除旧条
      const deduped = prev.filter((item) => item.content !== trimmed);
      // 新条插到最前（最新）
      const newItem: InputHistoryItem = { content: trimmed, timestamp: Date.now() };
      const next = [newItem, ...deduped];
      // 超出限制时截断
      const capped = next.slice(0, MAX_HISTORY);
      saveHistory(capped);
      return capped;
    });

    // 发送后重置导航状态
    historyIndexRef.current = -1;
    draftRef.current = "";
  }, []);

  const navigateUp = useCallback(
    (currentInput: string): string | null => {
      // 读取最新 history（由于 useState 是异步的，这里直接读 localStorage 保证最新）
      const hist = loadHistory();
      if (hist.length === 0) return null;

      if (historyIndexRef.current === -1) {
        // 第一次按 ↑：保存草稿，跳到最新一条
        draftRef.current = currentInput;
        historyIndexRef.current = 0;
        return hist[0].content;
      }

      // 已在历史中：向前翻（index 增大）
      const nextIdx = historyIndexRef.current + 1;
      if (nextIdx >= hist.length) {
        // 已到最旧，不再翻
        return null;
      }
      historyIndexRef.current = nextIdx;
      return hist[nextIdx].content;
    },
    []
  );

  const navigateDown = useCallback((): string | null => {
    if (historyIndexRef.current === -1) return null; // 未在浏览历史

    const prevIdx = historyIndexRef.current - 1;
    if (prevIdx < 0) {
      // 已回到草稿
      historyIndexRef.current = -1;
      const draft = draftRef.current;
      draftRef.current = "";
      return draft;
    }

    // 向后翻（index 减小）
    const hist = loadHistory();
    historyIndexRef.current = prevIdx;
    return hist[prevIdx]?.content ?? "";
  }, []);

  const resetNavigation = useCallback(() => {
    historyIndexRef.current = -1;
    draftRef.current = "";
  }, []);

  return {
    history,
    pushHistory,
    navigateUp,
    navigateDown,
    resetNavigation,
    isBrowsing,
  };
}
