import { selectTheme, theme } from "./theme";

export interface ModelChoice {
  provider: string;
  ollamaModel?: string;
  claudeModel?: string;
}

const CLAUDE_MODELS = [
  { alias: "opus", description: "Claude Opus (strongest)" },
  { alias: "sonnet", description: "Claude Sonnet (balanced)" },
  { alias: "haiku", description: "Claude Haiku (fast)" },
  { alias: "fable", description: "Claude Fable (fast)" },
];

interface ModelPickerProps {
  ollamaModels: string[];
  focused: boolean;
  onPick: (choice: ModelChoice) => void;
  /** Текущий выбор: provider + опционально ollamaModel/claudeModel для подсветки. */
  current?: ModelChoice;
  /** Активно ли под-меню выбора модели семейства Claude. */
  claudeFamilyOpen: boolean;
  /** Запросить открытие под-меню Claude (выбор строки "Claude" в главном списке). */
  onOpenClaudeFamily: () => void;
}

export function ModelPicker({
  ollamaModels,
  focused,
  onPick,
  current,
  claudeFamilyOpen,
  onOpenClaudeFamily,
}: ModelPickerProps) {
  // Текущая подпись для строки claude в главном списке.
  const claudeLabel =
    current?.provider === "claude-cli"
      ? `Claude (${current.claudeModel ?? "sonnet"})`
      : "Claude";

  // Главный список: claude одной строкой + локальные ollama-модели.
  const mainOptions = [
    { name: claudeLabel, description: "Anthropic Claude CLI", value: "claude-cli" },
    ...ollamaModels.map((m) => ({
      name: `ollama: ${m}`,
      description: "Local Ollama model",
      value: `ollama:${m}`,
    })),
  ];

  const mainCurrentValue =
    current?.provider === "ollama"
      ? `ollama:${current.ollamaModel ?? ""}`
      : "claude-cli";
  const mainSelectedIndex = Math.max(
    0,
    mainOptions.findIndex((o) => o.value === mainCurrentValue),
  );

  // Семейство claude: opus / sonnet / fable.
  const familyOptions = CLAUDE_MODELS.map((m) => ({
    name: `claude:${m.alias}`,
    description: m.description,
    value: `claude:${m.alias}`,
  }));
  const familySelectedIndex = Math.max(
    0,
    familyOptions.findIndex(
      (o) => o.value === `claude:${current?.claudeModel ?? "sonnet"}`,
    ),
  );

  // Под-меню семейства: выбор модели → commit.
  if (claudeFamilyOpen) {
    return (
      <box
        title="Claude model"
        style={{ border: true, borderColor: theme.muted, height: Math.min(familyOptions.length * 2 + 2, 12) }}
      >
        <select
          focused={focused}
          options={familyOptions}
          selectedIndex={familySelectedIndex}
          onSelect={(_, option) => {
            const value = option?.value as string | undefined;
            if (!value) return;
            onPick({ provider: "claude-cli", claudeModel: value.slice("claude:".length) });
          }}
          style={{ flexGrow: 1, ...selectTheme }}
        />
      </box>
    );
  }

  return (
    <box title="Select model" style={{ border: true, borderColor: theme.muted, height: Math.min(mainOptions.length * 2 + 2, 14) }}>
      <select
        focused={focused}
        options={mainOptions}
        selectedIndex={mainSelectedIndex}
        onSelect={(_, option) => {
          const value = option?.value as string | undefined;
          if (!value) return;
          if (value === "claude-cli") {
            onOpenClaudeFamily();
            return;
          }
          onPick({ provider: "ollama", ollamaModel: value.slice("ollama:".length) });
        }}
        style={{ flexGrow: 1, ...selectTheme }}
      />
    </box>
  );
}