import { theme } from "./theme";

interface ConnectPromptProps {
  pendingPrompt?: string | null;
}

export function ConnectPrompt({ pendingPrompt }: ConnectPromptProps) {
  return (
    <box
      title="spotify"
      style={{ border: true, borderColor: theme.yellow, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
    >
      <text fg={theme.yellow}>Spotify не подключён. Подключиться сейчас?</text>
      <box style={{ flexDirection: "row" }}>
        <text fg={theme.green}>[y]</text>
        <text fg={theme.fg}> да · </text>
        <text fg={theme.red}>[n]</text>
        <text fg={theme.fg}> нет / esc</text>
      </box>
      {pendingPrompt && (
        <box style={{ flexDirection: "row" }}>
          <text fg={theme.muted}>» </text>
          <text fg={theme.fg}>{pendingPrompt}</text>
        </box>
      )}
    </box>
  );
}