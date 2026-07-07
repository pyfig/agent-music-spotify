import { selectTheme, theme } from "./theme";

export type ConfirmAction = "add" | "listen" | "cancel" | "continue";

type Option = { name: string; description: string; value: ConfirmAction };

// Display name for the active backend so the "Add" action names the right
// service instead of a hardcoded "Spotify".
function backendLabel(backend?: string): string {
  switch (backend) {
    case "youtube-music":
      return "YouTube Music";
    case "soundcloud":
      return "SoundCloud";
    case "spotify":
      return "Spotify";
    default:
      return backend ?? "backend";
  }
}

// Backends without remote playlists (youtube-music, soundcloud) queue tracks
// locally instead of creating a service-side playlist — reflect that in the
// "Add" option's copy.
function buildOptions(backend?: string, remotePlaylists = true): Option[] {
  const add: Option = remotePlaylists
    ? { name: "Add", description: `create playlist on ${backendLabel(backend)} and add these tracks`, value: "add" }
    : { name: "Add", description: "queue all these tracks for local playback", value: "add" };
  return [
    add,
    { name: "Just listen", description: "keep the list — play tracks with ⏎, no playlist created", value: "listen" },
    { name: "Continue generation", description: "regenerate a fresh list for the same request", value: "continue" },
    { name: "Cancel", description: "discard this list", value: "cancel" },
  ];
}

interface ConfirmActionsProps {
  focused: boolean;
  onAction: (action: ConfirmAction) => void;
  /** Active music backend id (spotify | youtube-music | soundcloud). */
  backend?: string;
  /** Whether the backend creates service-side playlists (else local queue). */
  remotePlaylists?: boolean;
}

export function ConfirmActions({ focused, onAction, backend, remotePlaylists }: ConfirmActionsProps) {
  const OPTIONS = buildOptions(backend, remotePlaylists);
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
