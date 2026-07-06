import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ProviderList, type ProviderPick } from "./ProviderList";
import { PromptInput } from "./PromptInput";
import { selectTheme, theme } from "./theme";
import type { Config, FileConfig } from "../config";

type Kind = "text" | "secret" | "enum";

interface FieldDef {
  key: keyof FileConfig;
  label: string;
  kind: Kind;
  placeholder?: string;
  options?: { label: string; description: string; value: string }[];
}

// Curated from opencode.ai/docs/zen model catalog, grouped by upstream family.
const ZEN_MODELS: { label: string; description: string; value: string }[] = [
  // Anthropic-format
  { label: "claude-sonnet-5", description: "anthropic · balanced", value: "claude-sonnet-5" },
  { label: "claude-opus-4-8", description: "anthropic · strongest", value: "claude-opus-4-8" },
  { label: "claude-haiku-4-5", description: "anthropic · fast", value: "claude-haiku-4-5" },
  { label: "claude-fable-5", description: "anthropic · fast", value: "claude-fable-5" },
  { label: "qwen3.7-max", description: "anthropic-format", value: "qwen3.7-max" },
  { label: "qwen3.7-plus", description: "anthropic-format", value: "qwen3.7-plus" },
  // OpenAI-format (responses)
  { label: "gpt-5.5", description: "openai-responses", value: "gpt-5.5" },
  { label: "gpt-5.5-pro", description: "openai-responses", value: "gpt-5.5-pro" },
  { label: "gpt-5.4", description: "openai-responses", value: "gpt-5.4" },
  { label: "gpt-5.3-codex", description: "openai-responses", value: "gpt-5.3-codex" },
  { label: "gpt-5", description: "openai-responses", value: "gpt-5" },
  { label: "gpt-5-codex", description: "openai-responses", value: "gpt-5-codex" },
  // Google-format
  { label: "gemini-3.1-pro", description: "google", value: "gemini-3.1-pro" },
  { label: "gemini-3.5-flash", description: "google", value: "gemini-3.5-flash" },
  { label: "gemini-3-flash", description: "google", value: "gemini-3-flash" },
  // OpenAI-compatible-format
  { label: "deepseek-v4-pro", description: "openai-compat", value: "deepseek-v4-pro" },
  { label: "glm-5.2", description: "openai-compat", value: "glm-5.2" },
  { label: "glm-5.1", description: "openai-compat", value: "glm-5.1" },
  { label: "kimi-k2.7-code", description: "openai-compat", value: "kimi-k2.7-code" },
  { label: "kimi-k2.6", description: "openai-compat", value: "kimi-k2.6" },
  { label: "minimax-m3", description: "openai-compat", value: "minimax-m3" },
  { label: "grok-build-0.1", description: "openai-compat", value: "grok-build-0.1" },
];

// Go tier exposes only the open / non-frontier models (openai-compat family) — no GPT/Claude/Gemini.
const GO_MODELS: { label: string; description: string; value: string }[] = [
  { label: "glm-5.2", description: "openai-compat", value: "glm-5.2" },
  { label: "glm-5.1", description: "openai-compat", value: "glm-5.1" },
  { label: "glm-5", description: "openai-compat", value: "glm-5" },
  { label: "deepseek-v4-pro", description: "openai-compat", value: "deepseek-v4-pro" },
  { label: "deepseek-v4-flash", description: "openai-compat", value: "deepseek-v4-flash" },
  { label: "deepseek-v4-flash-free", description: "openai-compat · free", value: "deepseek-v4-flash-free" },
  { label: "kimi-k2.7-code", description: "openai-compat", value: "kimi-k2.7-code" },
  { label: "kimi-k2.6", description: "openai-compat", value: "kimi-k2.6" },
  { label: "kimi-k2.5", description: "openai-compat", value: "kimi-k2.5" },
  { label: "minimax-m3", description: "openai-compat", value: "minimax-m3" },
  { label: "minimax-m2.7", description: "openai-compat", value: "minimax-m2.7" },
  { label: "grok-build-0.1", description: "openai-compat", value: "grok-build-0.1" },
  { label: "big-pickle", description: "openai-compat", value: "big-pickle" },
  { label: "mimo-v2.5-free", description: "openai-compat · free", value: "mimo-v2.5-free" },
  { label: "north-mini-code-free", description: "openai-compat · free", value: "north-mini-code-free" },
  { label: "nemotron-3-ultra-free", description: "openai-compat · free", value: "nemotron-3-ultra-free" },
];

interface ProviderConfigDef {
  /** provider id, or "ollama:settings" for the ollama URL page (no "use" row). */
  id: string;
  title: string;
  /** Set to show a "▶ use <label>" row that commits defaultProvider. null/undefined = no use row. */
  useLabel?: string;
  fields: FieldDef[];
}

const PROVIDER_CONFIGS: ProviderConfigDef[] = [
  {
    id: "claude-cli",
    title: "Claude",
    useLabel: "Claude",
    fields: [
      {
        key: "claudeModel",
        label: "model",
        kind: "enum",
        options: [
          { label: "opus", description: "Claude Opus (strongest)", value: "opus" },
          { label: "sonnet", description: "Claude Sonnet (balanced)", value: "sonnet" },
          { label: "haiku", description: "Claude Haiku (fast)", value: "haiku" },
          { label: "fable", description: "Claude Fable (fast)", value: "fable" },
        ],
      },
      {
        key: "claudeEffort",
        label: "effort",
        kind: "enum",
        options: [
          { label: "low", description: "fastest, least reasoning", value: "low" },
          { label: "medium", description: "balanced", value: "medium" },
          { label: "high", description: "most reasoning", value: "high" },
          { label: "none", description: "omit --effort flag", value: "none" },
        ],
      },
      {
        key: "customSystemPrompt",
        label: "system prompt",
        kind: "text",
        placeholder: "e.g. prefer deep cuts over singles…",
      },
    ],
  },
  {
    id: "opencode-go",
    title: "opencode: go",
    useLabel: "opencode-go",
    fields: [
      { key: "opencodeGoApiKey", label: "api key", kind: "secret", placeholder: "bearer token…" },
      { key: "opencodeGoBaseUrl", label: "base url", kind: "text", placeholder: "https://opencode.ai/zen/go/v1" },
      { key: "opencodeGoModel", label: "go model", kind: "enum", options: GO_MODELS },
    ],
  },
  {
    id: "opencode-zen",
    title: "opencode: zen",
    useLabel: "opencode-zen",
    fields: [
      { key: "opencodeZenApiKey", label: "api key", kind: "secret", placeholder: "bearer token…" },
      { key: "opencodeZenBaseUrl", label: "base url", kind: "text", placeholder: "https://opencode.ai/zen/v1" },
      { key: "opencodeZenModel", label: "zen model", kind: "enum", options: ZEN_MODELS },
    ],
  },
  {
    id: "openai",
    title: "OpenAI",
    useLabel: "OpenAI",
    fields: [
      {
        key: "openaiAuthMode",
        label: "auth mode",
        kind: "enum",
        options: [
          { label: "api", description: "platform API key (sk-…)", value: "api" },
          { label: "subs", description: "ChatGPT subscription bearer token", value: "subs" },
        ],
      },
      { key: "openaiApiKey", label: "api key (api mode)", kind: "secret", placeholder: "sk-…" },
      { key: "openaiSubsToken", label: "subs token (subs mode)", kind: "secret", placeholder: "ChatGPT subscription bearer…" },
      { key: "openaiBaseUrl", label: "base url", kind: "text", placeholder: "https://api.openai.com/v1" },
      { key: "openaiModel", label: "model", kind: "text", placeholder: "gpt-5" },
    ],
  },
  {
    id: "ollama:settings",
    title: "Ollama daemon",
    fields: [
      { key: "ollamaUrl", label: "url", kind: "text", placeholder: "http://127.0.0.1:11434" },
      { key: "ollamaModel", label: "model", kind: "text", placeholder: "llama3" },
    ],
  },
];

type Level = "list" | "config" | "editor";

interface ModelPickerProps {
  ollamaModels: string[];
  config: Config;
  focused: boolean;
  /** Commit defaultProvider (+ close the picker unless opts.closePicker is false). Returns an error message on failure. */
  onUseProvider: (provider: string, opts?: { closePicker?: boolean }) => Promise<string | null>;
  /** Save a field edit without switching provider. */
  onSaveField: (partial: FileConfig) => Promise<void> | void;
  /** Close the picker without committing. */
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

export function ModelPicker({
  ollamaModels,
  config,
  focused,
  onUseProvider,
  onSaveField,
  onClose,
}: ModelPickerProps) {
  const [level, setLevel] = useState<Level>("list");
  const [providerId, setProviderId] = useState<string>("claude-cli");
  const [editKey, setEditKey] = useState<keyof FileConfig | null>(null);
  const [textValue, setTextValue] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);

  const cfg = PROVIDER_CONFIGS.find((c) => c.id === providerId) ?? PROVIDER_CONFIGS[0]!;
  const field = cfg.fields.find((f) => f.key === editKey) ?? null;
  const normalizedProviderId = providerId === "ollama:settings" ? "ollama" : providerId;

  // After a field save, try to activate the provider being configured — mirrors
  // Ollama's one-tap flow instead of requiring a separate "▶ use" step.
  async function activateIfNeeded() {
    if (normalizedProviderId === config.defaultProvider) {
      setPickerError(null);
      return;
    }
    const msg = await onUseProvider(normalizedProviderId, { closePicker: false });
    setPickerError(msg);
  }

  useKeyboard((key) => {
    if (key.name !== "escape") return;
    if (level === "editor") {
      setTextValue("");
      setLevel("config");
      return;
    }
    if (level === "config") {
      setPickerError(null);
      setLevel("list");
      return;
    }
    onClose();
  });

  // Level 0: main provider list.
  if (level === "list") {
    return (
      <ProviderList
        ollamaModels={ollamaModels}
        focused={focused}
        current={{
          provider: config.defaultProvider,
          ...(config.defaultProvider === "ollama" ? { ollamaModel: config.ollamaModel } : {}),
          ...(config.defaultProvider === "claude-cli" ? { claudeModel: config.claudeModel } : {}),
        }}
        onPick={(choice) => {
          // ollama model rows commit immediately (no config page).
          if (choice.provider === "ollama" && choice.ollamaModel) {
            void (async () => {
              await onSaveField({ ollamaModel: choice.ollamaModel } as FileConfig);
              await onUseProvider("ollama");
            })();
            return;
          }
          setProviderId(choice.provider);
          setEditKey(null);
          setPickerError(null);
          setLevel("config");
        }}
      />
    );
  }

  // Level 1: provider config page — fields + optional "use" row.
  if (level === "config") {
    const fieldOptions = cfg.fields.map((f) => ({
      name: f.label,
      description: displayValue(f, config),
      value: f.key as string,
    }));
    const useRow = cfg.useLabel
      ? [{ name: `\u25b6 use ${cfg.useLabel}`, description: "switch to this provider", value: "__use__" }]
      : [];
    const options = [...fieldOptions, ...useRow];
    const fieldSelectedIndex = Math.max(
      0,
      options.findIndex((o) => o.value === (editKey as string | undefined)),
    );

    return (
      <box
        title={cfg.title}
        style={{
          border: true,
          borderColor: theme.accent,
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          height: Math.min(options.length * 2 + 3, 24),
        }}
      >
        <text fg={theme.subtext}>edit fields to auto-switch, or pick "use" · esc back</text>
        <select
          focused={focused}
          options={options}
          selectedIndex={fieldSelectedIndex}
          onSelect={(_, option) => {
            const value = option?.value as string | undefined;
            if (!value) return;
            if (value === "__use__") {
              void (async () => {
                const msg = await onUseProvider(normalizedProviderId);
                setPickerError(msg);
              })();
              return;
            }
            const f = cfg.fields.find((x) => x.key === value);
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
        {pickerError ? (
          <text fg={theme.red}>✗ {pickerError}</text>
        ) : normalizedProviderId === config.defaultProvider ? (
          <text fg={theme.green}>✓ active</text>
        ) : null}
      </box>
    );
  }

  // Level 2: field editor.
  if (!field) return null;
  const enumOptions =
    field.options?.map((o) => ({ name: o.label, description: o.description, value: o.value })) ?? [];
  const enumSelectedIndex = Math.max(
    0,
    enumOptions.findIndex((o) => o.value === currentValue(field, config)),
  );

  return (
    <box
      title={`${cfg.title} · ${field.label}`}
      style={{
        border: true,
        borderColor: theme.accent,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        ...(field.kind === "enum" ? { height: Math.min(enumOptions.length * 2 + 2, 24) } : {}),
      }}
    >
      <text fg={theme.subtext}>{field.label} · esc back</text>
      {field.kind === "enum" ? (
        <select
          focused={focused}
          options={enumOptions}
          selectedIndex={enumSelectedIndex}
          onSelect={(_, option) => {
            const value = option?.value as string | undefined;
            if (!value) return;
            void (async () => {
              await onSaveField({ [field.key]: value } as FileConfig);
              await activateIfNeeded();
            })();
            setLevel("config");
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
            onSubmit={(v) => {
              void (async () => {
                await onSaveField({ [field.key]: v } as FileConfig);
                await activateIfNeeded();
              })();
              setTextValue("");
              setLevel("config");
            }}
            focused={focused}
          />
          <text fg={theme.muted}>enter save · esc back</text>
        </>
      )}
    </box>
  );
}
