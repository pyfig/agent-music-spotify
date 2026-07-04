interface PromptInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focused: boolean;
}

export function PromptInput({ placeholder, value, onChange, onSubmit, focused }: PromptInputProps) {
  return (
    <box style={{ border: true, borderColor: "#585b70", height: 3, paddingLeft: 1, paddingRight: 1 }}>
      <input
        placeholder={placeholder}
        value={value}
        focused={focused}
        onInput={onChange}
        onSubmit={onSubmit as unknown as (event: unknown) => void}
      />
    </box>
  );
}
