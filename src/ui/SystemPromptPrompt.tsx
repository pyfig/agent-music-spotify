import { PromptInput } from "./PromptInput";
import { theme } from "./theme";

interface SystemPromptPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focused: boolean;
}

export function SystemPromptPrompt({
  value,
  onChange,
  onSubmit,
  focused,
}: SystemPromptPromptProps) {
  return (
    <box
      title="set custom system prompt"
      style={{
        border: true,
        borderColor: theme.accent,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.subtext}>
        extra instructions appended to Claude's system prompt for every request
      </text>
      <PromptInput
        placeholder="e.g. prefer deep cuts over singles…"
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        focused={focused}
      />
      <text fg={theme.muted}>enter save · esc cancel</text>
    </box>
  );
}
