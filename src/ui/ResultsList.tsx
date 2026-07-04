export interface ResultLine {
  key: string;
  label: string;
  resolved: boolean;
}

interface ResultsListProps {
  title?: string;
  lines: ResultLine[];
  selectedIndex: number;
}

export function ResultsList({ title, lines, selectedIndex }: ResultsListProps) {
  if (lines.length === 0) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg="#585b70">Describe a mood or theme, press Enter — get a playlist.</text>
      </box>
    );
  }
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      {title && <text fg="#89b4fa"> {title}</text>}
      <scrollbox style={{ flexGrow: 1 }}>
        {lines.map((line, i) => (
          <text
            key={line.key}
            fg={line.resolved ? (i === selectedIndex ? "#cdd6f4" : "#a6adc8") : "#f38ba8"}
            bg={i === selectedIndex ? "#313244" : undefined}
          >
            {i === selectedIndex ? " ❯ " : "   "}
            {line.label}
            {line.resolved ? "" : "  (not found)"}
          </text>
        ))}
      </scrollbox>
    </box>
  );
}
