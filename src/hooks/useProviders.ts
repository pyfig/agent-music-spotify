import { useMemo } from "react";
import type { Config } from "../config";
import type { AgentProvider } from "../agent/types";
import { ClaudeCliProvider } from "../agent/providers/claude-cli";
import { OllamaProvider } from "../agent/providers/ollama";
import { OpencodeProvider } from "../agent/providers/opencode";
import { OpenAIProvider } from "../agent/providers/openai";

/** Constructs the active AgentProvider from config. Memoized on the config
 * object: saveConfig() returns a fresh Config, so any settings edit rebuilds
 * the provider with the new credentials/model. */
export function useProvider(config: Config | null): AgentProvider | null {
  return useMemo(() => {
    if (!config) return null;
    switch (config.defaultProvider) {
      case "ollama":
        return new OllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel });
      case "opencode-go":
        return new OpencodeProvider({
          name: "opencode-go",
          apiKey: config.opencodeGoApiKey,
          baseUrl: config.opencodeGoBaseUrl,
          model: config.opencodeGoModel,
        });
      case "opencode-zen":
        return new OpencodeProvider({
          name: "opencode-zen",
          apiKey: config.opencodeZenApiKey,
          baseUrl: config.opencodeZenBaseUrl,
          model: config.opencodeZenModel,
        });
      case "openai": {
        return new OpenAIProvider({
          authMode: config.openaiAuthMode,
          apiKey: config.openaiApiKey,
          subsToken: config.openaiSubsToken,
          baseUrl: config.openaiBaseUrl,
          model: config.openaiModel,
        });
      }
      case "claude-cli":
      default:
        return new ClaudeCliProvider({
          model: config.claudeModel,
          effort: config.claudeEffort,
          systemPrompt: config.customSystemPrompt,
        });
    }
  }, [config]);
}

/** Status-bar label for the active provider+model. */
export function modelLabelFor(config: Config | null): string {
  if (!config) return "";
  return config.defaultProvider === "ollama"
    ? `ollama:${config.ollamaModel}`
    : config.defaultProvider === "opencode-go"
      ? `opencode-go:${config.opencodeGoModel}`
      : config.defaultProvider === "opencode-zen"
        ? `opencode-zen:${config.opencodeZenModel}`
        : config.defaultProvider === "openai"
          ? `openai:${config.openaiModel} · ${config.openaiAuthMode}`
          : `claude:${config.claudeModel} · effort:${config.claudeEffort}`;
}
