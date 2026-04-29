import React, { useEffect, useRef, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import type { FileTab, PendingChatCommand, AiChatCommandType } from "../../store/editorStore";
import type { AiSettingsState } from "../../store/aiSettingsStore";

interface EditorPaneProps {
  tab: FileTab;
  onContentChange: (id: string, content: string) => void;
  onCursorChange: (id: string, line: number, column: number) => void;
  onSave: (id: string) => void;
  aiSettings: AiSettingsState;
  pendingNavigation?: { line: number; matchStart?: number; matchEnd?: number } | null;
  onNavigationComplete?: () => void;
  onAiCommand?: (cmd: PendingChatCommand) => void;
}

// 防抖工具
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

// 去除 AI 返回的 markdown 代码块包裹
function stripCodeBlock(text: string): string {
  const trimmed = text.trim();
  // 去掉 ```lang\n...\n``` 包裹
  const blockMatch = trimmed.match(/^```[\w]*\r?\n?([\s\S]*?)\r?\n?```$/);
  if (blockMatch) return blockMatch[1].trim();
  // 去掉单行反引号
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const EditorPane: React.FC<EditorPaneProps> = ({
  tab,
  onContentChange,
  onCursorChange,
  onSave,
  aiSettings,
  pendingNavigation,
  onNavigationComplete,
  onAiCommand,
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // 保存 InlineCompletionsProvider 的 dispose 函数
  const providerDisposableRef = useRef<{ dispose: () => void } | null>(null);
  // 标记最近一次「来自外部」的内容变更，避免触发 onContentChange 循环
  const externalUpdateRef = useRef(false);

  // 注册 InlineCompletionsProvider（Ghost Text）
  const registerInlineProvider = useCallback(
    (monacoInstance: typeof import("monaco-editor"), _editorInstance: editor.IStandaloneCodeEditor) => {
      // 先清理旧的 provider
      if (providerDisposableRef.current) {
        providerDisposableRef.current.dispose();
        providerDisposableRef.current = null;
      }

      if (!aiSettings.settings.inlineCompleteEnabled) return;

      const cfg = aiSettings.getActiveProviderConfig();
      if (!cfg.enabled || !cfg.apiKey) return;

      // 防抖包装的补全请求
      let lastRequestId = 0;

      const provideInlineCompletions = debounce(
        async (
          model: editor.ITextModel,
          position: { lineNumber: number; column: number },
          resolve: (items: languages.InlineCompletion[]) => void
        ): Promise<void> => {
          const currentRequestId = ++lastRequestId;

          // 获取光标前最多 50 行文本
          const startLine = Math.max(1, position.lineNumber - 50);
          const prefix = model.getValueInRange({
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          // 获取光标后少量文本作为 suffix
          const totalLines = model.getLineCount();
          const endLine = Math.min(totalLines, position.lineNumber + 5);
          const suffix = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: endLine,
            endColumn: model.getLineMaxColumn(endLine),
          });

          // 太短不触发
          if (prefix.trim().length < 3) {
            resolve([]);
            return;
          }

          try {
            const result = await invoke<string>("ai_complete", {
              request: {
                provider: cfg.provider,
                api_key: cfg.apiKey,
                base_url: cfg.baseUrl ?? null,
                model: cfg.completeModel,
                prefix,
                suffix,
                language: tab.language,
                max_tokens: 128,
              },
            });

            // 如果有新请求发出，丢弃旧结果
            if (currentRequestId !== lastRequestId) {
              resolve([]);
              return;
            }

            if (result && result.trim()) {
              const cleanResult = stripCodeBlock(result);
              if (cleanResult) {
                resolve([
                  {
                    insertText: cleanResult,
                    range: {
                      startLineNumber: position.lineNumber,
                      startColumn: position.column,
                      endLineNumber: position.lineNumber,
                      endColumn: position.column,
                    },
                  },
                ]);
              } else {
                resolve([]);
              }
            } else {
              resolve([]);
            }
          } catch (err) {
            console.warn("AI 补全请求失败:", err);
            resolve([]);
          }
        },
        aiSettings.settings.inlineCompleteDelay
      );

      // 注册 provider
      const disposable = monacoInstance.languages.registerInlineCompletionsProvider("*", {
        provideInlineCompletions(model, position, _context, _token) {
          return new Promise<languages.InlineCompletions>((resolve) => {
            provideInlineCompletions(model, position, (items: languages.InlineCompletion[]) => {
              resolve({ items });
            });
          });
        },
        disposeInlineCompletions() {
          // 无需清理
        },
      });

      providerDisposableRef.current = disposable;
    },
    [aiSettings, tab.language]
  );

  const applyNavigation = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    nav: { line: number; matchStart?: number; matchEnd?: number }
  ) => {
    editorInstance.revealLineInCenter(nav.line);
    if (nav.matchStart !== undefined && nav.matchEnd !== undefined) {
      editorInstance.setSelection({
        startLineNumber: nav.line,
        startColumn: nav.matchStart + 1,
        endLineNumber: nav.line,
        endColumn: nav.matchEnd + 1,
      });
    } else {
      editorInstance.setPosition({ lineNumber: nav.line, column: 1 });
    }
    editorInstance.focus();
  }, []);

  const handleMount: OnMount = (editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;

    // 注册 Ctrl+S 保存快捷键（CtrlCmd=2048, KeyS=49）
    editorInstance.addCommand(2048 | 49, () => {
      onSave(tab.id);
    });

    // 监听光标位置变化
    editorInstance.onDidChangeCursorPosition((e) => {
      onCursorChange(tab.id, e.position.lineNumber, e.position.column);
    });

    // 注册 AI 内联补全 provider
    registerInlineProvider(monacoInstance, editorInstance);

    // ─── 注册 AI 右键菜单 ────────────────────────────────────────────────────
    const AI_MENU_GROUP = '9_ai';

    // 辅助函数：获取选中代码
    const getSelectedCode = (ed: editor.ICodeEditor): string => {
      const selection = ed.getSelection();
      const model = ed.getModel();
      if (!selection || !model) return '';
      return model.getValueInRange(selection);
    };

    // 辅助函数：注册发送到 Chat 的菜单项
    const registerChatAction = (
      id: string,
      label: string,
      order: number,
      command: AiChatCommandType
    ) => {
      editorInstance.addAction({
        id,
        label,
        contextMenuGroupId: AI_MENU_GROUP,
        contextMenuOrder: order,
        run: (ed) => {
          const code = getSelectedCode(ed);
          if (!code.trim()) return;
          onAiCommand?.({
            command,
            code,
            language: tab.language,
            timestamp: Date.now(),
          });
        },
      });
    };

    registerChatAction('ai-explain',  'AI 解释代码',    1, '/explain');
    registerChatAction('ai-fix',      'AI 修复代码',    2, '/fix');
    registerChatAction('ai-refactor', 'AI 重构代码',    3, '/refactor');
    registerChatAction('ai-tests',    '生成单元测试',   4, '/tests');

    // 「生成注释」：直接调用 AI 并 Apply 到编辑器
    editorInstance.addAction({
      id: 'ai-comment',
      label: 'AI 生成注释',
      contextMenuGroupId: AI_MENU_GROUP,
      contextMenuOrder: 5,
      run: async (ed) => {
        const selection = ed.getSelection();
        const model = ed.getModel();
        if (!selection || !model) return;
        const code = model.getValueInRange(selection);
        if (!code.trim()) return;

        const cfg = aiSettings.getActiveProviderConfig();
        if (!cfg.enabled || !cfg.apiKey) {
          console.warn('AI 生成注释：未配置 AI 提供商');
          return;
        }

        try {
          const comment = await invoke<string>('ai_complete', {
            request: {
              provider: cfg.provider,
              api_key: cfg.apiKey,
              base_url: cfg.baseUrl ?? null,
              model: cfg.completeModel,
              prefix: `请为以下 ${tab.language} 代码生成文档注释（只输出注释内容，不要重复代码本身）：\n\n${code}\n\n注释：`,
              suffix: '',
              language: tab.language,
              max_tokens: 256,
            },
          });

          if (comment.trim()) {
            const cleanComment = stripCodeBlock(comment);
            if (cleanComment) {
              // 在选中代码的起始行前插入注释
              ed.executeEdits('ai-comment', [
                {
                  range: {
                    startLineNumber: selection.startLineNumber,
                    startColumn: 1,
                    endLineNumber: selection.startLineNumber,
                    endColumn: 1,
                  },
                  text: cleanComment + '\n',
                },
              ]);
            }
          }
        } catch (err) {
          console.error('AI 生成注释失败:', err);
        }
      },
    });
    // ─────────────────────────────────────────────────────────────────────────

    // 挂载时若有待执行的导航，立即执行
    if (pendingNavigation) {
      setTimeout(() => {
        applyNavigation(editorInstance, pendingNavigation);
        onNavigationComplete?.();
      }, 50);
    }
  };

  // 当 tab 切换时，恢复光标位置
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setPosition({
        lineNumber: tab.cursorLine,
        column: tab.cursorColumn,
      });
      editorRef.current.focus();
    }
  }, [tab.id]);

  // ── 外部内容变更检测（AI 写入文件后的自动同步）────────────────────────────
  // 当 tab.content 被外部（forceUpdateContent）修改，且与编辑器当前内容不同时，
  // 使用 pushEditOperations 替换全文，保留光标位置和滚动状态，不清空 Undo 历史。
  useEffect(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;

    const model = editorInstance.getModel();
    if (!model) return;

    const currentModelContent = model.getValue();
    // 内容无变化时跳过（避免初始挂载或用户自身编辑触发）
    if (currentModelContent === tab.content) return;

    // 保留当前滚动位置
    const scrollTop = editorInstance.getScrollTop();
    const scrollLeft = editorInstance.getScrollLeft();

    // 标记此次为外部更新，供 onChange 回调识别
    externalUpdateRef.current = true;

    // 用 pushEditOperations 替换全文（保留 Undo 栈，不重置光标到行首）
    const fullRange = model.getFullModelRange();
    model.pushEditOperations(
      [],
      [{ range: fullRange, text: tab.content }],
      () => null
    );

    // 恢复滚动位置（替换操作可能引起轻微滚动漂移）
    requestAnimationFrame(() => {
      editorInstance.setScrollTop(scrollTop);
      editorInstance.setScrollLeft(scrollLeft);
      externalUpdateRef.current = false;
    });
  // tab.id 变化时由上方 useEffect 单独处理，此处仅响应内容变化
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.content]);

  useEffect(() => {
    if (!pendingNavigation || !editorRef.current) return;
    applyNavigation(editorRef.current, pendingNavigation);
    onNavigationComplete?.();
  }, [pendingNavigation]);

  // 当 AI 设置变化时，重新注册 provider
  useEffect(() => {
    if (editorRef.current) {
      // 需要 monaco 实例，通过 window.monaco 获取（@monaco-editor/react 会挂载到 window）
      const monacoInstance = (window as unknown as { monaco?: typeof import("monaco-editor") }).monaco;
      if (monacoInstance) {
        registerInlineProvider(monacoInstance, editorRef.current);
      }
    }
    return () => {
      if (providerDisposableRef.current) {
        providerDisposableRef.current.dispose();
        providerDisposableRef.current = null;
      }
    };
  }, [
    aiSettings.settings.inlineCompleteEnabled,
    aiSettings.settings.activeProvider,
    registerInlineProvider,
  ]);

  return (
    <div style={{ flex: 1, overflow: "hidden", height: "100%" }}>
      <Editor
        height="100%"
        theme="vs-dark"
        language={tab.language}
        value={tab.content}
        onChange={(value) => {
          // 外部强制更新期间，pushEditOperations 也会触发 onChange，需过滤
          if (externalUpdateRef.current) return;
          onContentChange(tab.id, value ?? "");
        }}
        onMount={handleMount}
        options={{
          fontSize: 14,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
          fontLigatures: true,
          minimap: { enabled: true },
          wordWrap: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          padding: { top: 8, bottom: 8 },
          // 启用内联建议（Ghost Text）
          inlineSuggest: {
            enabled: aiSettings.settings.inlineCompleteEnabled,
            mode: "prefix",
          },
        }}
      />
    </div>
  );
};

export default EditorPane;
