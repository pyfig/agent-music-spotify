import { selectTheme, theme } from "./theme";

export interface ProviderPick {
  provider: string;
  ollamaModel?: string;
  claudeModel?: string;
}

interface ProviderListProps {
  ollamaModels: string[];
  focused: boolean;
  onPick: (choice: ProviderPick) => void;
  current?: ProviderPick;
}

/**
 * Flat top-level list of AI providers/models, used by /model (level 0) and by
 * the first-run SetupWizard. Selecting a hosted provider opens its config
 * page; selecting an ollama model commits immediately.
 */
export function ProviderList({ ollamaModels, focused, onPick, current }: ProviderListProps) {
  const claudeLabel =
    current?.provider === "claude-cli"
      ? `Claude (${current.claudeModel ?? "sonnet"})`
      : "Claude";

  const mainOptions = [
    { name: claudeLabel, description: "Anthropic Claude CLI", value: "claude-cli" },
    { name: "opencode: go", description: "opencode hosted (glm-5.2)", value: "opencode-go" },
    { name: "opencode: zen", description: "opencode hosted (zen)", value: "opencode-zen" },
    { name: "openai", description: "OpenAI Chat Completions (api / subs)", value: "openai" },
    ...ollamaModels.map((m) => ({
      name: `ollama: ${m}`,
      description: "Local Ollama model",
      value: `ollama:${m}`,
    })),
    { name: "ollama: \u2699 url & model", description: "configure Ollama daemon URL", value: "ollama:settings" },
  ];

  const mainCurrentValue =
    current?.provider === "ollama"
      ? `ollama:${current.ollamaModel ?? ""}`
      : (current?.provider ?? "claude-cli");
  const mainSelectedIndex = Math.max(
    0,
    mainOptions.findIndex((o) => o.value === mainCurrentValue),
  );

  return (
    <box
      title="Select model"
      style={{ border: true, borderColor: theme.muted, height: Math.min(mainOptions.length * 2 + 2, 24) }}
    >
      <select
        focused={focused}
        options={mainOptions}
        selectedIndex={mainSelectedIndex}
        onSelect={(_, option) => {
          const value = option?.value as string | undefined;
          if (!value) return;
          if (value.startsWith("ollama:") && value !== "ollama:settings") {
            onPick({ provider: "ollama", ollamaModel: value.slice("ollama:".length) });
            return;
          }
          onPick({ provider: value });
        }}
        style={{ flexGrow: 1, ...selectTheme }}
      />
    </box>
  );
}
