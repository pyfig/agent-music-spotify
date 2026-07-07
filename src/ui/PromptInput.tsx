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
    // Focused input brightens its border one step so the active surface is
    // visible when focus moves elsewhere (e.g. into the confirm menu).
    <box style={{ border: true, borderColor: focused ? theme.subtext : theme.muted, height: 3, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
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
