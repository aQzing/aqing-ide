import React, { useState, useCallback } from "react";
import type { AiProvider, AiProviderConfig, AiSettingsState } from "../../store/aiSettingsStore";

interface SettingsModalProps {
  aiSettings: AiSettingsState;
  onClose: () => void;
}

// 提供商显示名称
const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  dashscope: "通义千问 (DashScope)",
  custom: "自定义 (OpenAI 兼容)",
};

// 各提供商预设模型列表
const PROVIDER_CHAT_MODELS: Record<AiProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-3-5",
    "claude-3-opus-20240229",
  ],
  dashscope: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
  custom: [],
};

const PROVIDER_COMPLETE_MODELS: Record<AiProvider, string[]> = {
  openai: ["gpt-4o-mini", "gpt-3.5-turbo"],
  anthropic: ["claude-haiku-3-5", "claude-sonnet-4-5"],
  dashscope: ["qwen-turbo", "qwen-plus"],
  custom: [],
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "#3c3c3c",
  color: "#cccccc",
  fontSize: "13px",
  padding: "6px 10px",
  borderRadius: "4px",
  border: "1px solid #555",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  color: "#aaaaaa",
  marginBottom: "4px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "#bbbbbb",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: "12px",
  paddingBottom: "6px",
  borderBottom: "1px solid #3c3c3c",
};

const SettingsModal: React.FC<SettingsModalProps> = ({ aiSettings, onClose }) => {
  const { settings, updateProvider, setActiveProvider, setInlineCompleteEnabled, saveSettings } =
    aiSettings;

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [selectedTab, setSelectedTab] = useState<AiProvider>(settings.activeProvider);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      await saveSettings();
      setSaveMsg("已保存");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg("保存失败");
    } finally {
      setSaving(false);
    }
  }, [saveSettings]);

  const cfg = settings.providers[selectedTab];

  const updateField = (field: keyof AiProviderConfig, value: string | boolean) => {
    updateProvider(selectedTab, { [field]: value });
  };

  const providers: AiProvider[] = ["openai", "anthropic", "dashscope", "custom"];

  return (
    // 遮罩层
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 模态框 */}
      <div
        style={{
          width: "680px",
          maxHeight: "80vh",
          backgroundColor: "#252526",
          borderRadius: "8px",
          border: "1px solid #3c3c3c",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid #3c3c3c",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#cccccc" }}>
            AI 设置
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* 内容区 */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* 左侧 Tab 导航 */}
          <div
            style={{
              width: "160px",
              flexShrink: 0,
              backgroundColor: "#1e1e1e",
              borderRight: "1px solid #3c3c3c",
              padding: "8px 0",
              overflowY: "auto",
            }}
          >
            <div style={{ padding: "4px 12px 8px", fontSize: "11px", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              AI 提供商
            </div>
            {providers.map((p) => (
              <div
                key={p}
                onClick={() => setSelectedTab(p)}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  cursor: "pointer",
                  color: selectedTab === p ? "#ffffff" : "#aaaaaa",
                  backgroundColor: selectedTab === p ? "#37373d" : "transparent",
                  borderLeft: selectedTab === p ? "2px solid #007acc" : "2px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: settings.providers[p].enabled ? "#4ec9b0" : "#555",
                    flexShrink: 0,
                  }}
                />
                {PROVIDER_LABELS[p].split(" ")[0]}
              </div>
            ))}

            {/* 通用设置 */}
            <div style={{ marginTop: "16px", padding: "4px 12px 8px", fontSize: "11px", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              通用
            </div>
            <div
              onClick={() => setSelectedTab("custom")}
              style={{
                padding: "8px 12px",
                fontSize: "13px",
                cursor: "pointer",
                color: "#aaaaaa",
              }}
            >
              {/* 占位，后续可扩展 */}
            </div>
          </div>

          {/* 右侧配置区 */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            <div style={sectionTitleStyle}>{PROVIDER_LABELS[selectedTab]}</div>

            {/* 启用开关 */}
            <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
              <label style={{ ...labelStyle, marginBottom: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => updateField("enabled", e.target.checked)}
                  style={{ width: "14px", height: "14px", cursor: "pointer" }}
                />
                <span>启用此提供商</span>
              </label>
              {cfg.enabled && settings.activeProvider !== selectedTab && (
                <button
                  onClick={() => setActiveProvider(selectedTab)}
                  style={{
                    fontSize: "11px",
                    padding: "3px 8px",
                    backgroundColor: "#007acc",
                    color: "white",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                >
                  设为默认
                </button>
              )}
              {settings.activeProvider === selectedTab && (
                <span style={{ fontSize: "11px", color: "#4ec9b0" }}>当前默认</span>
              )}
            </div>

            {/* API Key */}
            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>API Key</label>
              <input
                type="password"
                value={cfg.apiKey}
                onChange={(e) => updateField("apiKey", e.target.value)}
                placeholder={`输入 ${PROVIDER_LABELS[selectedTab]} API Key`}
                style={inputStyle}
              />
            </div>

            {/* 自定义 Base URL（仅 custom 和 dashscope 显示） */}
            {(selectedTab === "custom" || selectedTab === "dashscope") && (
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>
                  Base URL {selectedTab === "dashscope" ? "(可选，默认使用官方地址)" : ""}
                </label>
                <input
                  type="text"
                  value={cfg.baseUrl ?? ""}
                  onChange={(e) => updateField("baseUrl", e.target.value)}
                  placeholder={
                    selectedTab === "custom"
                      ? "http://localhost:11434/v1"
                      : "https://dashscope.aliyuncs.com/compatible-mode"
                  }
                  style={inputStyle}
                />
              </div>
            )}

            {/* Chat 模型 */}
            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>Chat 模型</label>
              {PROVIDER_CHAT_MODELS[selectedTab].length > 0 ? (
                <select
                  value={cfg.chatModel}
                  onChange={(e) => updateField("chatModel", e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {PROVIDER_CHAT_MODELS[selectedTab].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={cfg.chatModel}>{cfg.chatModel} (自定义)</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={cfg.chatModel}
                  onChange={(e) => updateField("chatModel", e.target.value)}
                  placeholder="输入模型名称"
                  style={inputStyle}
                />
              )}
            </div>

            {/* 补全模型 */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>代码补全模型（建议使用更快的小模型）</label>
              {PROVIDER_COMPLETE_MODELS[selectedTab].length > 0 ? (
                <select
                  value={cfg.completeModel}
                  onChange={(e) => updateField("completeModel", e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {PROVIDER_COMPLETE_MODELS[selectedTab].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={cfg.completeModel}>{cfg.completeModel} (自定义)</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={cfg.completeModel}
                  onChange={(e) => updateField("completeModel", e.target.value)}
                  placeholder="输入模型名称"
                  style={inputStyle}
                />
              )}
            </div>

            {/* 内联补全开关（仅在通用设置区显示，这里放在最后） */}
            <div style={{ ...sectionTitleStyle, marginTop: "8px" }}>内联代码补全</div>
            <label style={{ ...labelStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={settings.inlineCompleteEnabled}
                onChange={(e) => setInlineCompleteEnabled(e.target.checked)}
                style={{ width: "14px", height: "14px", cursor: "pointer" }}
              />
              <span>启用 AI 内联代码补全（Ghost Text）</span>
            </label>
            <p style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
              在编辑器中输入时自动触发 AI 补全建议，按 Tab 接受，Esc 取消
            </p>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "10px",
            padding: "12px 20px",
            borderTop: "1px solid #3c3c3c",
            flexShrink: 0,
          }}
        >
          {saveMsg && (
            <span style={{ fontSize: "12px", color: saveMsg === "已保存" ? "#4ec9b0" : "#f48771" }}>
              {saveMsg}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px",
              backgroundColor: "transparent",
              color: "#cccccc",
              border: "1px solid #555",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "6px 16px",
              backgroundColor: "#007acc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: "13px",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
