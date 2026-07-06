import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { PromptInput } from "./PromptInput";
import { selectTheme, theme } from "./theme";
import type { Config, FileConfig } from "../config";

type Kind = "text" | "secret" | "enum";

interface FieldDef {
  key: keyof FileConfig;
  label: string;
  kind: Kind;
  envVar?: string;
  placeholder?: string;
  options?: { label: string; description: string; value: string }[];
}

interface SectionDef {
  id: string;
  title: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "music-backend",
    title: "Music: Backend",
    fields: [
      {
        key: "musicBackend",
        label: "music backend",
        kind: "enum",
        envVar: "MUSIC_BACKEND",
        options: [
          { label: "spotify", description: "Spotify (remote playlists + playback)", value: "spotify" },
          { label: "soundcloud", description: "SoundCloud (local mpv)", value: "soundcloud" },
          { label: "youtube-music", description: "YouTube Music (local mpv + yt-dlp)", value: "youtube-music" },
        ],
      },
    ],
  },
  {
    id: "music-spotify",
    title: "Music: Spotify",
    fields: [
      {
        key: "spotifyClientId",
        label: "spotify client id",
        kind: "text",
        envVar: "SPOTIFY_CLIENT_ID",
        placeholder: "32 hex chars…",
      },
    ],
  },
  {
    id: "music-soundcloud",
    title: "Music: SoundCloud",
    fields: [
      {
        key: "soundcloudClientId",
        label: "soundcloud client id",
        kind: "text",
        envVar: "SOUNDCLOUD_CLIENT_ID",
        placeholder: "api-v2 client_id…",
      },
    ],
  },
];

type Level = "sections" | "fields" | "editor";

interface SettingsScreenProps {
  config: Config;
  initialSection?: string;
  focused: boolean;
  onSave: (partial: FileConfig) => Promise<void> | void;
  onClose: () => void;
}

function maskSecret(v: string): string {
  if (!v) return "not set";
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function currentValue(field: FieldDef, config: Config): string {
  const v = (config as unknown as Record<string, unknown>)[field.key as string];
  if (v === undefined || v === null) return "";
  return String(v);
}

function displayValue(field: FieldDef, config: Config): string {
  const v = currentValue(field, config);
  if (field.kind === "secret") return maskSecret(v);
  return v === "" ? "(empty)" : v;
}

export function SettingsScreen({
  config,
  initialSection,
  focused,
  onSave,
  onClose,
}: SettingsScreenProps) {
  const [level, setLevel] = useState<Level>(initialSection ? "fields" : "sections");
  const [sectionId, setSectionId] = useState<string>(initialSection ?? SECTIONS[0]!.id);
  const [editKey, setEditKey] = useState<keyof FileConfig | null>(null);
  const [textValue, setTextValue] = useState("");

  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0]!;
  const field = section.fields.find((f) => f.key === editKey) ?? null;

  // Esc navigates back through the three levels. <select>/<input> own their
  // own printable/arrow/enter keys; this hook only catches Esc.
  useKeyboard((key) => {
    if (key.name !== "escape") return;
    if (level === "editor") {
      setTextValue("");
      setLevel("fields");
      return;
    }
    if (level === "fields") {
      setLevel("sections");
      return;
    }
    onClose();
  });

  const sectionOptions = SECTIONS.map((s) => ({
    name: s.title,
    description: `${s.fields.length} field${s.fields.length === 1 ? "" : "s"}`,
    value: s.id,
  }));
  const sectionSelectedIndex = Math.max(
    0,
    sectionOptions.findIndex((o) => o.value === sectionId),
  );

  const fieldOptions = section.fields.map((f) => ({
    name: f.label,
    description: displayValue(f, config),
    value: f.key as string,
  }));
  const fieldSelectedIndex = Math.max(
    0,
    fieldOptions.findIndex((o) => o.value === (editKey as string | undefined)),
  );

  const enumOptions =
    field?.options?.map((o) => ({
      name: o.label,
      description: o.description,
      value: o.value,
    })) ?? [];
  const enumSelectedIndex = field
    ? Math.max(
        0,
        enumOptions.findIndex((o) => o.value === currentValue(field, config)),
      )
    : 0;

  const header =
    level === "editor" && field
      ? `${section.title} · ${field.label}`
      : level === "fields"
        ? section.title
        : "Settings";

  async function commitText(value: string) {
    if (!field) return;
    await onSave({ [field.key]: value } as FileConfig);
    setTextValue("");
    setLevel("fields");
  }

  async function commitEnum(value: string) {
    if (!field) return;
    await onSave({ [field.key]: value } as FileConfig);
    setLevel("fields");
  }

  return (
    <box
      title={header}
      style={{
        border: true,
        borderColor: theme.accent,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {level === "sections" && (
        <>
          <text fg={theme.subtext}>Pick a section · esc to close</text>
          <select
            focused={focused}
            options={sectionOptions}
            selectedIndex={sectionSelectedIndex}
            onSelect={(_, option) => {
              const id = option?.value as string | undefined;
              if (!id) return;
              setSectionId(id);
              setEditKey(null);
              setLevel("fields");
            }}
            style={{ flexGrow: 1, ...selectTheme }}
          />
        </>
      )}

      {level === "fields" && (
        <>
          <text fg={theme.subtext}>Pick a field to edit · esc back</text>
          <select
            focused={focused}
            options={fieldOptions}
            selectedIndex={fieldSelectedIndex}
            onSelect={(_, option) => {
              const key = option?.value as keyof FileConfig | undefined;
              if (!key) return;
              const f = section.fields.find((x) => x.key === key);
              if (!f) return;
              setEditKey(f.key);
              if (f.kind === "text" || f.kind === "secret") {
                setTextValue(currentValue(f, config));
              } else {
                setTextValue("");
              }
              setLevel("editor");
            }}
            style={{ flexGrow: 1, ...selectTheme }}
          />
        </>
      )}

      {level === "editor" && field && (
        <>
          <text fg={theme.subtext}>{field.label} · esc back</text>
          {field.kind === "enum" ? (
            <select
              focused={focused}
              options={enumOptions}
              selectedIndex={enumSelectedIndex}
              onSelect={(_, option) => {
                const value = option?.value as string | undefined;
                if (!value) return;
                void commitEnum(value);
              }}
              style={{ flexGrow: 1, ...selectTheme }}
            />
          ) : (
            <>
              <text fg={theme.muted}>current: {displayValue(field, config)}</text>
              <PromptInput
                placeholder={field.placeholder ?? `enter ${field.label}…`}
                value={textValue}
                onChange={setTextValue}
                onSubmit={(v) => void commitText(v)}
                focused={focused}
              />
              <text fg={theme.muted}>enter save · esc back</text>
            </>
          )}
        </>
      )}
    </box>
  );
}
