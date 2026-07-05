import type { MusicBackend } from "../music/types";
import { selectTheme, theme } from "./theme";

const BACKENDS: { value: MusicBackend; name: string; description: string }[] = [
  {
    value: "spotify",
    name: "Spotify",
    description: "Remote playlists + Spotify Connect playback",
  },
  {
    value: "soundcloud",
    name: "SoundCloud",
    description: "Search + local playback via mpv",
  },
  {
    value: "youtube-music",
    name: "YouTube Music",
    description: "Search + local playback via mpv + yt-dlp",
  },
];

interface MusicBackendPickerProps {
  focused: boolean;
  current: MusicBackend;
  onPick: (backend: MusicBackend) => void;
}

export function MusicBackendPicker({ focused, current, onPick }: MusicBackendPickerProps) {
  const options = BACKENDS.map((b) => ({
    name: b.value === current ? `${b.name} ✓` : b.name,
    description: b.description,
    value: b.value,
  }));
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current),
  );
  return (
    <box
      title="Music backend"
      style={{ border: true, borderColor: theme.muted, height: Math.min(options.length * 2 + 2, 10) }}
    >
      <select
        focused={focused}
        options={options}
        selectedIndex={selectedIndex}
        onSelect={(_, option) => {
          const value = option?.value as MusicBackend | undefined;
          if (value) onPick(value);
        }}
        style={{ flexGrow: 1, ...selectTheme }}
      />
    </box>
  );
}
