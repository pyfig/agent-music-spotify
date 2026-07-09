import { PromptInput } from "./PromptInput";
import { theme } from "./theme";

interface ClientIdPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  error?: string;
  focused: boolean;
  currentId: string;
  isDefault: boolean;
}

export function ClientIdPrompt({
  value,
  onChange,
  onSubmit,
  error,
  focused,
  currentId,
  isDefault,
}: ClientIdPromptProps) {
  const envOverride = process.env.SPOTIFY_CLIENT_ID !== undefined;
  return (
    <box title="set spotify client id" style={{ border: true, borderColor: theme.accent, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
      <text fg={theme.subtext}>
        1. open <a href="https://developer.spotify.com/dashboard">developer.spotify.com/dashboard</a> (ctrl+o) →
        Create app
      </text>
      <text fg={theme.subtext}>2. Redirect URI: http://127.0.0.1/callback (no port) · API: Web API</text>
      <text fg={theme.subtext}>3. copy the Client ID (32 hex chars), paste below (cmd+v)</text>
      <text fg={theme.muted}>
        current: {currentId}
        {isDefault ? " (built-in shared)" : ""}
      </text>
      {envOverride && (
        <text fg={theme.red}>note: SPOTIFY_CLIENT_ID env var is set and overrides saved config</text>
      )}
      <PromptInput
        placeholder="paste client id…"
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        focused={focused}
      />
      {error && <text fg={theme.red}>{error}</text>}
      <text fg={theme.muted}>enter save &amp; re-login · ctrl+o open dashboard · esc cancel</text>
    </box>
  );
}
