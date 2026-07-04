interface StatusBarProps {
  model: string;
  authed: boolean;
  loading: boolean;
  error?: string;
}

export function StatusBar({ model, authed, loading, error }: StatusBarProps) {
  return (
    <box style={{ height: 1, flexDirection: "row" }}>
      {error ? (
        <text fg="#f38ba8"> {error}</text>
      ) : (
        <text fg="#585b70">
          {" "}
          {model} · spotify {authed ? "✓" : "—"}
          {loading ? " · generating…" : " · /model to switch · enter to play · q quit"}
        </text>
      )}
    </box>
  );
}
