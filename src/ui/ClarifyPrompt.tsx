import { PromptInput } from "./PromptInput";
import { selectTheme, theme } from "./theme";

const CUSTOM_VALUE = "__custom__";

interface ClarifyPromptProps {
  questionText: string;
  options: string[];
  stepLabel: string;
  focused: boolean;
  customMode: boolean;
  customValue: string;
  onChangeCustom: (value: string) => void;
  onSubmitCustom: (value: string) => void;
  onPickOption: (option: string) => void;
  onPickCustom: () => void;
}

export function ClarifyPrompt({
  questionText,
  options,
  stepLabel,
  focused,
  customMode,
  customValue,
  onChangeCustom,
  onSubmitCustom,
  onPickOption,
  onPickCustom,
}: ClarifyPromptProps) {
  if (customMode) {
    return (
      <box title={`clarify ${stepLabel} — your answer`} style={{ border: true, borderColor: theme.accent, flexDirection: "column" }}>
        <text fg={theme.fg}>{questionText}</text>
        <PromptInput
          placeholder="your answer… (esc to go back)"
          value={customValue}
          onChange={onChangeCustom}
          onSubmit={onSubmitCustom}
          focused={focused}
        />
      </box>
    );
  }

  const selectOptions = [
    ...options.map((o) => ({ name: o, description: "", value: o })),
    { name: "Custom… (type your own answer)", description: "", value: CUSTOM_VALUE },
  ];

  // Height hugs content: question (1) + one line per option + border (2).
  return (
    <box
      title={`clarify ${stepLabel}`}
      style={{ border: true, borderColor: theme.accent, height: selectOptions.length + 3, flexShrink: 0, flexDirection: "column" }}
    >
      <text fg={theme.fg}>{questionText}</text>
      <select
        focused={focused}
        options={selectOptions}
        selectedIndex={0}
        showDescription={false}
        onSelect={(_, option) => {
          const value = option?.value as string | undefined;
          if (!value) return;
          if (value === CUSTOM_VALUE) {
            onPickCustom();
            return;
          }
          onPickOption(value);
        }}
        style={{
          flexGrow: 1,
          ...selectTheme,
          // Unselected options dimmed so the active row reads instantly.
          textColor: theme.subtext,
          focusedTextColor: theme.subtext,
        }}
      />
    </box>
  );
}
