import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import { isConfigured, loadConfig, saveConfig, type Config } from "./config";
import { ClaudeCliProvider } from "./agent/providers/claude-cli";
import { OllamaProvider, listOllamaModels } from "./agent/providers/ollama";
import type { AgentProvider } from "./agent/types";
import { getAccessToken, isAuthenticated } from "./spotify/auth";
import { SpotifyClient } from "./spotify/client";
import { generatePlaylist, type GeneratedPlaylist } from "./core/generate-playlist";
import { PromptInput } from "./ui/PromptInput";
import { ResultsList, type ResultLine } from "./ui/ResultsList";
import { StatusBar } from "./ui/StatusBar";
import { SetupWizard } from "./ui/SetupWizard";
import { ModelPicker, type ModelChoice } from "./ui/ModelPicker";

type Screen = "loading" | "wizard" | "main";

export function App() {
  const { width } = useTerminalDimensions();
  const [config, setConfig] = useState<Config | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [result, setResult] = useState<GeneratedPlaylist | null>(null);

  useEffect(() => {
    loadConfig().then(async (c) => {
      setConfig(c);
      setAuthed(await isAuthenticated(c));
      setOllamaModels(await listOllamaModels(c.ollamaUrl));
      setScreen(isConfigured(c) ? "main" : "wizard");
    });
  }, []);

  const provider: AgentProvider | null = useMemo(() => {
    if (!config) return null;
    return config.defaultProvider === "ollama"
      ? new OllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel })
      : new ClaudeCliProvider();
  }, [config]);

  const modelLabel = config
    ? config.defaultProvider === "ollama"
      ? `ollama:${config.ollamaModel}`
      : config.defaultProvider
    : "";

  const lines: ResultLine[] = useMemo(() => {
    if (!result) return [];
    return [
      ...result.resolved.map((t, i) => ({
        key: `r${i}`,
        label: `${t.artist} — ${t.name}`,
        resolved: true,
      })),
      ...result.unresolved.map((t, i) => ({
        key: `u${i}`,
        label: `${t.artist} — ${t.title}`,
        resolved: false,
      })),
    ];
  }, [result]);

  useKeyboard(async (key) => {
    if (key.ctrl && key.name === "c") process.exit(0);
    if (screen !== "main") return;
    if (pickerOpen) {
      if (key.name === "escape") setPickerOpen(false);
      return;
    }
    if (key.name === "escape") {
      setError(undefined);
      return;
    }
    if (key.ctrl && key.name === "p") {
      await applyModelChoice(
        config?.defaultProvider === "ollama"
          ? { provider: "claude-cli" }
          : { provider: "ollama" },
      );
      return;
    }
    // Input owns printable keys; only handle chrome/navigation.
    if (key.name === "down") {
      setSelectedIndex((i) => Math.min(i + 1, Math.max(lines.length - 1, 0)));
      return;
    }
    if (key.name === "up") {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
  });

  async function applyModelChoice(choice: ModelChoice) {
    const next = await saveConfig({
      defaultProvider: choice.provider,
      ...(choice.ollamaModel ? { ollamaModel: choice.ollamaModel } : {}),
    });
    setConfig(next);
    setPickerOpen(false);
  }

  async function handleSubmit(value: string) {
    const trimmed = value.trim();
    if (trimmed === "/model") {
      setInput("");
      setOllamaModels(await listOllamaModels(config!.ollamaUrl));
      setPickerOpen(true);
      return;
    }
    if (trimmed === "/quit" || trimmed === "/exit") process.exit(0);
    if (trimmed.length === 0) {
      if (result) await handlePlay();
      return;
    }
    if (!config || !provider || loading) return;
    setError(undefined);
    setLoading(true);
    try {
      const token = await getAccessToken(config);
      setAuthed(true);
      const spotify = new SpotifyClient(token);
      const generated = await generatePlaylist(provider, spotify, trimmed);
      setResult(generated);
      setSelectedIndex(0);
      setInput("");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePlay() {
    if (!config || !result) return;
    try {
      const token = await getAccessToken(config);
      const spotify = new SpotifyClient(token);
      const track = result.resolved[selectedIndex];
      await spotify.play(track ? track.uri : result.playlist.uri);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  const columnWidth = Math.min(72, Math.max(40, width - 4));

  return (
    <box style={{ flexGrow: 1, alignItems: "center", flexDirection: "column" }}>
      <box style={{ width: columnWidth, flexDirection: "column", flexGrow: 1, paddingTop: 1 }}>
        <box style={{ alignItems: "center" }}>
          <ascii-font text="tuneforge" font="tiny" style={{ color: "#89b4fa" }} />
        </box>

        {screen === "loading" && <text fg="#585b70">loading…</text>}

        {screen === "wizard" && config && (
          <SetupWizard
            ollamaModels={ollamaModels}
            initialClientId={config.spotifyClientId}
            onDone={async (r) => {
              const next = await saveConfig({
                defaultProvider: r.provider,
                spotifyClientId: r.spotifyClientId,
                ...(r.ollamaModel ? { ollamaModel: r.ollamaModel } : {}),
              });
              setConfig(next);
              setScreen("main");
            }}
          />
        )}

        {screen === "main" && pickerOpen && (
          <ModelPicker ollamaModels={ollamaModels} focused onPick={applyModelChoice} />
        )}

        {screen === "main" && !pickerOpen && (
          <>
            <PromptInput
              placeholder="describe an album to forge… (/model to switch model)"
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              focused
            />
            <ResultsList
              title={result ? `${result.playlist.name} — ${result.resolved.length} tracks` : undefined}
              lines={lines}
              selectedIndex={selectedIndex}
            />
            <StatusBar model={modelLabel} authed={authed} loading={loading} error={error} />
          </>
        )}
      </box>
    </box>
  );
}
