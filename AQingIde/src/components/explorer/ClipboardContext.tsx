import React, { createContext, useContext, useState, useCallback } from "react";

// ─── 剪贴板类型 ───────────────────────────────────────────────────────────────

export interface ClipboardEntry {
  type: "copy" | "cut";
  path: string;
  name: string;
}

interface ClipboardContextValue {
  clipboard: ClipboardEntry | null;
  setClipboard: (entry: ClipboardEntry | null) => void;
  clearClipboard: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ClipboardContext = createContext<ClipboardContextValue>({
  clipboard: null,
  setClipboard: () => {},
  clearClipboard: () => {},
});

export const ClipboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clipboard, setClipboardState] = useState<ClipboardEntry | null>(null);

  const setClipboard = useCallback((entry: ClipboardEntry | null) => {
    setClipboardState(entry);
  }, []);

  const clearClipboard = useCallback(() => {
    setClipboardState(null);
  }, []);

  return (
    <ClipboardContext.Provider value={{ clipboard, setClipboard, clearClipboard }}>
      {children}
    </ClipboardContext.Provider>
  );
};

export function useClipboard() {
  return useContext(ClipboardContext);
}
