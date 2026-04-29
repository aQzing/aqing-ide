// ─── 命令系统类型定义 ────────────────────────────────────────────────────────

export interface SlashCommand {
  /** 命令名，以 / 开头，全小写 */
  name: string;
  /** 简短描述（显示在下拉菜单中） */
  description: string;
  /** 是否为内置命令（内置命令不发送消息，仅执行副作用） */
  isBuiltin?: boolean;
}

// ─── 命令注册表 ──────────────────────────────────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/history",
    description: "查看输入历史记录",
    isBuiltin: true,
  },
];

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 根据输入内容过滤匹配的命令
 * @param input 用户当前输入（如 "/h" → 匹配 /history）
 */
export function filterCommands(input: string): SlashCommand[] {
  const lower = input.toLowerCase().trim();
  if (!lower.startsWith("/")) return [];
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(lower));
}

/**
 * 判断输入是否完全匹配某个内置命令（用于触发执行）
 * @returns 匹配到的命令，或 null
 */
export function matchBuiltinCommand(input: string): SlashCommand | null {
  const lower = input.toLowerCase().trim();
  return (
    SLASH_COMMANDS.find((cmd) => cmd.isBuiltin && cmd.name === lower) ?? null
  );
}
