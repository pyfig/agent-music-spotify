import { useEffect, useState } from "react";
import {
  isConfigured,
  loadConfig,
  saveConfig,
  type Config,
  type FileConfig,
} from "../config";
import { isAuthenticated } from "../spotify/auth";
import { listOllamaModels } from "../agent/providers/ollama";

export type Screen = "loading" | "wizard" | "main";

/**
 * Owns the loaded Config, top-level screen routing, and the ollama model list.
 * The boot effect resolves config + auth once; cross-domain side effects
 * (marking auth, opening the connect overlay, playback volume priming) are
 * injected via `onBooted` so this hook stays free of auth/playback state.
 */
export function useAppConfig(deps: {
  onBooted: (c: Config, authed: boolean) => void;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  useEffect(() => {
    loadConfig().then(async (c) => {
      setConfig(c);
      const a = await isAuthenticated(c);
      deps.onBooted(c, a);
      setOllamaModels(await listOllamaModels(c.ollamaUrl));
      setScreen(isConfigured(c) ? "main" : "wizard");
    });
    // Boot exactly once; deps.onBooted from the first render closes over
    // stable setters/refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist a partial config and adopt the merged result. */
  async function saveAndSet(partial: FileConfig): Promise<Config> {
    const next = await saveConfig(partial);
    setConfig(next);
    return next;
  }

  /** /model field edits: save without switching provider (picker stays open). */
  async function onSaveField(partial: FileConfig) {
    await saveAndSet(partial);
  }

  /** First-run wizard handoff: persist choices, optionally request Spotify connect. */
  async function finishWizard(
    r: {
      provider: string;
      musicBackend: Config["musicBackend"];
      soundcloudClientId?: string;
      ollamaModel?: string;
      claudeModel?: string;
    },
    opts: { needSpotifyConnect: boolean; onNeedConnect: () => void },
  ) {
    await saveAndSet({
      defaultProvider: r.provider,
      musicBackend: r.musicBackend,
      ...(r.soundcloudClientId ? { soundcloudClientId: r.soundcloudClientId } : {}),
      ...(r.ollamaModel ? { ollamaModel: r.ollamaModel } : {}),
      ...(r.claudeModel ? { claudeModel: r.claudeModel } : {}),
    });
    if (opts.needSpotifyConnect) opts.onNeedConnect();
    setScreen("main");
  }

  return {
    config,
    setConfig,
    screen,
    setScreen,
    ollamaModels,
    setOllamaModels,
    saveAndSet,
    onSaveField,
    finishWizard,
  };
}
