import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ProviderList, type ProviderPick } from "./ProviderList";
import { MusicBackendPicker } from "./MusicBackendPicker";
import { PromptInput } from "./PromptInput";
import { checkLocalPlaybackDeps } from "../music/playback";
import { scrapeClientId } from "../music/soundcloud/auth";
import type { MusicBackend } from "../music/types";
import { theme } from "./theme";

export type SetupResult = ProviderPick & {
  musicBackend: MusicBackend;
  soundcloudClientId?: string;
};

interface SetupWizardProps {
  ollamaModels: string[];
  onDone: (result: SetupResult) => void;
}

type Step = "backend" | "deps" | "sc-auto" | "sc-manual" | "model";

export function SetupWizard({ ollamaModels, onDone }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("backend");
  const [backend, setBackend] = useState<MusicBackend>("spotify");
  const [depError, setDepError] = useState<string | null>(null);
  const [scClientId, setScClientId] = useState<string | undefined>(undefined);
  const [scManualText, setScManualText] = useState("");

  function afterDeps(b: MusicBackend): Step {
    return b === "soundcloud" ? "sc-auto" : "model";
  }

  function pickBackend(b: MusicBackend) {
    setBackend(b);
    if (b === "spotify") {
      setStep("model");
      return;
    }
    const err = checkLocalPlaybackDeps(b);
    if (err) {
      setDepError(err);
      setStep("deps");
    } else {
      setStep(afterDeps(b));
    }
  }

  // SoundCloud: try to auto-scrape a client_id; fall back to manual paste.
  useEffect(() => {
    if (step !== "sc-auto") return;
    let cancelled = false;
    scrapeClientId()
      .then((id) => {
        if (cancelled) return;
        if (id) {
          setScClientId(id);
          setStep("model");
        } else {
          setStep("sc-manual");
        }
      })
      .catch(() => {
        if (!cancelled) setStep("sc-manual");
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  useKeyboard((key) => {
    if (step === "deps") {
      if (key.name === "r") {
        const err = checkLocalPlaybackDeps(backend);
        setDepError(err);
        if (!err) setStep(afterDeps(backend));
        return;
      }
      // Search still works without the binaries; playback will error later.
      if (key.name === "return") setStep(afterDeps(backend));
      if (key.name === "escape") setStep("backend");
      return;
    }
    if ((step === "sc-manual" || step === "sc-auto") && key.name === "escape") {
      setStep("backend");
    }
  });

  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.accent}>First-time setup</text>

      {step === "backend" && (
        <>
          <text fg={theme.muted}>Pick where your music lives. Switch any time with Ctrl+B.</text>
          <MusicBackendPicker focused current={backend} onPick={pickBackend} />
        </>
      )}

      {step === "deps" && (
        <>
          <text fg={theme.red}>{depError}</text>
          <text fg={theme.muted}>r — re-check after installing · enter — continue anyway · esc — back</text>
        </>
      )}

      {step === "sc-auto" && (
        <text fg={theme.muted}>trying to auto-detect a SoundCloud client_id…</text>
      )}

      {step === "sc-manual" && (
        <>
          <text fg={theme.muted}>
            auto-detect failed — paste a SoundCloud client_id (from browser devtools: any api-v2
            request's client_id query param)
          </text>
          <PromptInput
            placeholder="SoundCloud client_id…"
            value={scManualText}
            onChange={setScManualText}
            onSubmit={(v) => {
              const id = v.trim();
              if (!id) return;
              setScClientId(id);
              setStep("model");
            }}
            focused
          />
        </>
      )}

      {step === "model" && (
        <>
          <text fg={theme.muted}>
            Pick the AI model that generates your playlists.
            {backend === "spotify" ? " Spotify connection will be requested on the next step." : ""}
          </text>
          {scClientId && (
            <text fg={theme.muted}>soundcloud client_id: {scClientId.slice(0, 8)}… ✓</text>
          )}
          <ProviderList
            ollamaModels={ollamaModels}
            focused
            onPick={(choice) =>
              onDone({
                ...choice,
                musicBackend: backend,
                ...(scClientId ? { soundcloudClientId: scClientId } : {}),
              })
            }
          />
          {ollamaModels.length === 0 && (
            <text fg={theme.muted}>(ollama daemon not reachable — only claude-cli listed)</text>
          )}
        </>
      )}
    </box>
  );
}
