import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ModelPicker, type ModelChoice } from "./ModelPicker";
import { theme } from "./theme";

export type SetupResult = ModelChoice;

interface SetupWizardProps {
  ollamaModels: string[];
  onDone: (result: SetupResult) => void;
}

export function SetupWizard({ ollamaModels, onDone }: SetupWizardProps) {
  const [claudeFamilyOpen, setClaudeFamilyOpen] = useState(false);

  useKeyboard((key) => {
    if (claudeFamilyOpen && key.name === "escape") setClaudeFamilyOpen(false);
  });

  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.accent}>First-time setup</text>
      <text fg={theme.muted}>Pick the AI model that generates your playlists. Spotify connection will be requested on the next step.</text>
      <ModelPicker
        ollamaModels={ollamaModels}
        focused
        onPick={onDone}
        claudeFamilyOpen={claudeFamilyOpen}
        onOpenClaudeFamily={() => setClaudeFamilyOpen(true)}
      />
      {ollamaModels.length === 0 && (
        <text fg={theme.muted}>(ollama daemon not reachable — only claude-cli listed)</text>
      )}
    </box>
  );
}