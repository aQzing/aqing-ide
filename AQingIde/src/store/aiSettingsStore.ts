import { useState, useCallback, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type AiProvider = "openai" | "anthropic" | "dashscope" | "custom";

export interface AiProviderConfig {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  chatModel: string;
  completeModel: string;
  enabled: boolean;
}

export interface AiSettings {
  activeProvider: AiProvider;
  providers: Record<AiProvider, AiProviderConfig>;
  inlineCompleteEnabled: boolean;
  inlineCompleteDelay: number; // 防抖延迟 ms
}

// ─── 默认配置 ────────────────────────────────────────────────────────────────

const DEFAULT_PROVIDERS: Record<AiProvider, AiProviderConfig> = {
  openai: {
    provider: "openai",
    apiKey: "",
    chatModel: "gpt-4o",
    completeModel: "gpt-4o-mini",
    enabled: false,
  },
  anthropic: {
    provider: "anthropic",
    apiKey: "",
    chatModel: "claude-sonnet-4-5",
    completeModel: "claude-haiku-3-5",
    enabled: false,
  },
  dashscope: {
    provider: "dashscope",
    apiKey: "",
    chatModel: "qwen-plus",
    completeModel: "qwen-turbo",
    enabled: false,
  },
  custom: {
    provider: "custom",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    chatModel: "llama3",
    completeModel: "llama3",
    enabled: false,
  },
};

const DEFAULT_SETTINGS: AiSettings = {
  activeProvider: "anthropic",
  providers: DEFAULT_PROVIDERS,
  inlineCompleteEnabled: true,
  inlineCompleteDelay: 300,
};

// ─── Store 键名 ──────────────────────────────────────────────────────────────

const STORE_NAME = "settings";
const SETTINGS_KEY = "aiSettings";

// ─── AI 设置 Store Hook ──────────────────────────────────────────────────────

export interface AiSettingsState {
  settings: AiSettings;
  isLoaded: boolean;
  updateProvider: (provider: AiProvider, config: Partial<AiProviderConfig>) => void;
  setActiveProvider: (provider: AiProvider) => void;
  setInlineCompleteEnabled: (enabled: boolean) => void;
  saveSettings: () => Promise<void>;
  /** 获取当前激活 provider 的 Chat 模型名称（用于状态栏显示） */
  getActiveChatModelName: () => string;
  /** 获取当前激活 provider 的配置 */
  getActiveProviderConfig: () => AiProviderConfig;
}

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_NAME);
  }
  return storeInstance;
}

export function useAiSettingsStore(): AiSettingsState {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // 初始化：从 tauri-plugin-store 加载配置
  useEffect(() => {
    const load = async () => {
      try {
        const store = await getStore();
        const saved = await store.get<AiSettings>(SETTINGS_KEY);
        if (saved) {
          // 合并默认值，防止新增字段缺失
          setSettings({
            ...DEFAULT_SETTINGS,
            ...saved,
            providers: {
              ...DEFAULT_PROVIDERS,
              ...saved.providers,
            },
          });
        }
      } catch (err) {
        console.error("加载 AI 设置失败:", err);
      } finally {
        setIsLoaded(true);
      }
    };
    load();
  }, []);

  const saveSettings = useCallback(async () => {
    try {
      const store = await getStore();
      await store.set(SETTINGS_KEY, settings);
      await store.save();
    } catch (err) {
      console.error("保存 AI 设置失败:", err);
      throw err;
    }
  }, [settings]);

  const updateProvider = useCallback(
    (provider: AiProvider, config: Partial<AiProviderConfig>) => {
      setSettings((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          [provider]: { ...prev.providers[provider], ...config },
        },
      }));
    },
    []
  );

  const setActiveProvider = useCallback((provider: AiProvider) => {
    setSettings((prev) => ({ ...prev, activeProvider: provider }));
  }, []);

  const setInlineCompleteEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, inlineCompleteEnabled: enabled }));
  }, []);

  const getActiveChatModelName = useCallback((): string => {
    const cfg = settings.providers[settings.activeProvider];
    return cfg?.chatModel ?? "未配置";
  }, [settings]);

  const getActiveProviderConfig = useCallback((): AiProviderConfig => {
    return settings.providers[settings.activeProvider];
  }, [settings]);

  return {
    settings,
    isLoaded,
    updateProvider,
    setActiveProvider,
    setInlineCompleteEnabled,
    saveSettings,
    getActiveChatModelName,
    getActiveProviderConfig,
  };
}
