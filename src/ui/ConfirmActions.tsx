import { selectTheme, theme } from "./theme";

export type ConfirmAction = "add" | "listen" | "cancel" | "continue";

const OPTIONS: { name: string; description: string; value: ConfirmAction }[] = [
  { name: "Add", description: "create playlist on Spotify and add these tracks", value: "add" },
  { name: "Just listen", description: "keep the list — play tracks with ⏎, no playlist created", value: "listen" },
  { name: "Continue generation", description: "regenerate a fresh list for the same request", value: "continue" },
  { name: "Cancel", description: "discard this list", value: "cancel" },
];

interface ConfirmActionsProps {
  focused: boolean;
  onAction: (action: ConfirmAction) => void;
}

export function ConfirmActions({ focused, onAction }: ConfirmActionsProps) {
  return (
    <box title="what next?" style={{ border: true, borderColor: theme.green, height: OPTIONS.length * 2 + 2, flexShrink: 0 }}>
      <select
        focused={focused}
        options={OPTIONS}
        selectedIndex={0}
        onSelect={(_, option) => {
          const value = option?.value as ConfirmAction | undefined;
          if (value) onAction(value);
        }}
        style={{ flexGrow: 1, ...selectTheme }}
      />
    </box>
  );
}
