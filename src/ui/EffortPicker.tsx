import { selectTheme, theme } from "./theme";

const EFFORT_OPTIONS = [
  { name: "effort:low", description: "fastest, least reasoning", value: "low" },
  { name: "effort:medium", description: "balanced", value: "medium" },
  { name: "effort:high", description: "most reasoning", value: "high" },
  { name: "effort:none", description: "omit --effort flag", value: "none" },
];

interface EffortPickerProps {
  focused: boolean;
  onPick: (effort: string) => void;
  current: string;
}

export function EffortPicker({ focused, onPick, current }: EffortPickerProps) {
  const selectedIndex = Math.max(
    0,
    EFFORT_OPTIONS.findIndex((o) => o.value === current),
  );
  return (
    <box
      title="Claude effort"
      style={{
        border: true,
        borderColor: theme.muted,
        height: Math.min(EFFORT_OPTIONS.length * 2 + 2, 12),
      }}
    >
      <select
        focused={focused}
        options={EFFORT_OPTIONS}
        selectedIndex={selectedIndex}
        onSelect={(_, option) => {
          const value = option?.value as string | undefined;
          if (!value) return;
          onPick(value);
        }}
        style={{ flexGrow: 1, ...selectTheme }}
      />
    </box>
  );
}