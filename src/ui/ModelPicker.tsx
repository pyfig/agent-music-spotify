export interface ModelChoice {
  provider: string;
  ollamaModel?: string;
}

interface ModelPickerProps {
  ollamaModels: string[];
  focused: boolean;
  onPick: (choice: ModelChoice) => void;
}

export function ModelPicker({ ollamaModels, focused, onPick }: ModelPickerProps) {
  const options = [
    { name: "claude-cli", description: "Claude Code CLI (subprocess)", value: "claude-cli" },
    ...ollamaModels.map((m) => ({
      name: `ollama: ${m}`,
      description: "Local Ollama model",
      value: `ollama:${m}`,
    })),
  ];

  return (
    <box title="Select model" style={{ border: true, height: Math.min(options.length * 2 + 2, 14) }}>
      <select
        focused={focused}
        options={options}
        onSelect={(_, option) => {
          const value = option?.value as string | undefined;
          if (!value) return;
          if (value === "claude-cli") {
            onPick({ provider: "claude-cli" });
          } else {
            onPick({ provider: "ollama", ollamaModel: value.slice("ollama:".length) });
          }
        }}
        style={{ flexGrow: 1 }}
      />
    </box>
  );
}
