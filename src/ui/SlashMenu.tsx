import { theme } from "./theme";

export interface SlashCommand {
  cmd: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/model", description: "switch AI provider / model" },
  { cmd: "/random", description: "let the model pick a genre and generate" },
  { cmd: "/save", description: "save current track list as a playlist" },
  { cmd: "/login", description: "reconnect Spotify account" },
  { cmd: "/clientid", description: "set your own Spotify app client ID" },
  { cmd: "/quit", description: "exit vibedeck" },
];

export function filterSlashCommands(input: string): SlashCommand[] {
  const q = input.trim().toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
}

interface SlashMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
}

export function SlashMenu({ commands, selectedIndex }: SlashMenuProps) {
  if (commands.length === 0) return null;
  return (
    <box
      title="commands"
      style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
    >
      {commands.map((c, i) => (
        <box key={c.cmd} style={{ flexDirection: "row" }}>
          <text fg={i === selectedIndex ? theme.accent : theme.fg}>
            {i === selectedIndex ? "› " : "  "}
            {c.cmd.padEnd(10)}
          </text>
          <text fg={theme.muted}>{c.description}</text>
        </box>
      ))}
    </box>
  );
}
