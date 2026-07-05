import { theme } from "./theme";

interface PromptInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focused: boolean;
}

export function PromptInput({ placeholder, value, onChange, onSubmit, focused }: PromptInputProps) {
  return (
    <box style={{ border: true, borderColor: theme.muted, height: 3, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
      <input
        placeholder={placeholder}
        placeholderColor={theme.muted}
        cursorStyle={{ style: "line" }}
        value={value}
        focused={focused}
        onInput={onChange}
        onSubmit={onSubmit as unknown as (event: unknown) => void}
      />
    </box>
  );
}
