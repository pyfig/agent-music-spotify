import { useState } from "react";
import { ModelPicker, type ModelChoice } from "./ModelPicker";

export interface SetupResult {
  provider: string;
  ollamaModel?: string;
  spotifyClientId: string;
}

interface SetupWizardProps {
  ollamaModels: string[];
  initialClientId: string;
  onDone: (result: SetupResult) => void;
}

export function SetupWizard({ ollamaModels, initialClientId, onDone }: SetupWizardProps) {
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [clientId, setClientId] = useState(initialClientId);

  if (!choice) {
    return (
      <box style={{ flexDirection: "column" }}>
        <text fg="cyan">First-time setup — step 1/2</text>
        <text fg="gray">Pick the AI model that generates your playlists.</text>
        <ModelPicker ollamaModels={ollamaModels} focused onPick={setChoice} />
        {ollamaModels.length === 0 && (
          <text fg="gray">(ollama daemon not reachable — only claude-cli listed)</text>
        )}
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column" }}>
      <text fg="cyan">First-time setup — step 2/2</text>
      <text fg="gray">
        Spotify client ID (create app at developer.spotify.com, redirect URI
        http://127.0.0.1:8888/callback)
      </text>
      <box title="Spotify client ID" style={{ border: true, height: 3 }}>
        <input
          focused
          value={clientId}
          placeholder="32-char hex client id"
          onInput={setClientId}
          onSubmit={
            ((value: string) => {
              if (value.trim().length > 0) {
                onDone({ ...choice, spotifyClientId: value.trim() });
              }
            }) as unknown as (event: unknown) => void
          }
        />
      </box>
    </box>
  );
}
