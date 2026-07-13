import { theme } from "./theme";
// Names + descriptions live with the handlers in the dispatch table — the
// menu can never drift from what actually executes.
import { SLASH_COMMANDS } from "../app/commands";

export interface SlashCommand {
  cmd: string;
  description: string;
}

export { SLASH_COMMANDS };

export function filterSlashCommands(input: string): SlashCommand[] {
  const q = input.trim().toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
}

interface SlashMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  /** Max command rows to show at once; clamped to >= 1. Default 3. */
  maxVisible?: number;
  /** Outer column width, used to clip each row to a single line. */
  width?: number;
}

const DEFAULT_VISIBLE = 3;
// Width of the "marker + padded command + space" prefix on each row.
const PREFIX_WIDTH = 2 + 10 + 1;

function clip(s: string, n: number): string {
  if (n <= 0) return "";
  return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`;
}

export function SlashMenu({
  commands,
  selectedIndex,
  maxVisible = DEFAULT_VISIBLE,
  width = 72,
}: SlashMenuProps) {
  if (commands.length === 0) return null;
  const visible = Math.max(1, Math.min(maxVisible, commands.length));
  // Scroll window that keeps the selected command in view.
  const maxStart = Math.max(0, commands.length - visible);
  const start = Math.min(maxStart, Math.max(0, selectedIndex - visible + 1));
  const window = commands.slice(start, start + visible);
  const hiddenAbove = start;
  const hiddenBelow = commands.length - (start + window.length);
  // Keep every row exactly one line — wrapping a long description would grow
  // the box height and break the layout on short terminals.
  const descWidth = width - 4 - PREFIX_WIDTH;
  return (
    <box
      title="commands"
      style={{ border: true, borderColor: theme.muted, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
    >
      {window.map((c, i) => {
        const idx = start + i;
        return (
          <box key={c.cmd} style={{ flexDirection: "row" }}>
            <text fg={idx === selectedIndex ? theme.accent : theme.fg}>
              {idx === selectedIndex ? "› " : "  "}
              {c.cmd.padEnd(10)}{" "}
            </text>
            <text fg={theme.muted}>{clip(c.description, descWidth)}</text>
          </box>
        );
      })}
      {hiddenAbove > 0 || hiddenBelow > 0 ? (
        <text fg={theme.muted}>
          {"  "}
          {hiddenAbove > 0 ? `↑${hiddenAbove} ` : ""}
          {hiddenBelow > 0 ? `↓${hiddenBelow}` : ""}
        </text>
      ) : null}
    </box>
  );
}
