import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  PlugZap,
  Server,
  KeyRound,
  Sparkles,
} from 'lucide-react';
import type {
  AIProviderId,
  AIProviderInfo,
  AIProviderSelection,
} from '../types/annotation';

export const DEFAULT_AI_SELECTION: AIProviderSelection = {
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite',
};

export const AI_PROVIDER_LABELS: Record<AIProviderId, string> = {
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  nanogpt: 'NanoGPT',
  custom: 'Custom AI',
};

export function formatShortModelName(selection: AIProviderSelection): string {
  const raw = selection.model.trim();
  if (!raw) return AI_PROVIDER_LABELS[selection.provider];
  const parts = raw.split('/');
  const leaf = parts[parts.length - 1] || raw;
  return leaf.length > 26 ? `${leaf.slice(0, 24)}…` : leaf;
}

interface AIProviderModalProps {
  selection: AIProviderSelection;
  onSaveSelection: (next: AIProviderSelection) => void;
  onClose: () => void;
}

interface LiveModelItem {
  id: string;
  name: string;
}

const SAFE_MODEL_RE = /^[a-zA-Z0-9._:/@-]{1,128}$/;

export default function AIProviderModal({
  selection,
  onSaveSelection,
  onClose,
}: AIProviderModalProps) {
  const [providers, setProviders] = useState<AIProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draftProvider, setDraftProvider] = useState<AIProviderId>(selection.provider);
  const [draftModel, setDraftModel] = useState<string>(selection.model);

  const [liveModels, setLiveModels] = useState<LiveModelItem[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; model: string; latencyMs: number }
    | { ok: false; error: string }
    | null
  >(null);

  const fetchProviderStatus = useCallback(async () => {
    setLoadingProviders(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/ai/providers', { method: 'GET' });
      const raw = await res.text();
      let parsed: { providers?: AIProviderInfo[]; error?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        throw new Error(parsed.error || `Failed to load AI providers (${res.status}).`);
      }
      setProviders(parsed.providers ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to fetch AI provider status.');
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    void fetchProviderStatus();
  }, [fetchProviderStatus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const activeInfo = useMemo(
    () => providers.find((p) => p.id === draftProvider) ?? null,
    [providers, draftProvider]
  );

  const handleSelectProvider = (info: AIProviderInfo) => {
    setDraftProvider(info.id);
    setLiveModels([]);
    setModelsError(null);
    setModelSearch('');
    setTestResult(null);
    if (info.id === selection.provider && selection.model.trim()) {
      setDraftModel(selection.model);
    } else {
      setDraftModel(info.defaultModel);
    }
  };

  const handleFetchLiveModels = async () => {
    setFetchingModels(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: draftProvider }),
      });
      const raw = await res.text();
      let parsed: { models?: LiveModelItem[]; error?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        throw new Error(parsed.error || `Could not fetch models (${res.status}).`);
      }
      setLiveModels(parsed.models ?? []);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Failed to load live model catalog.');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    const trimmedModel = draftModel.trim();
    if (draftProvider !== 'gemini' && trimmedModel && !SAFE_MODEL_RE.test(trimmedModel)) {
      setTestResult({
        ok: false,
        error: 'Model ID contains unsupported characters. Use standard provider slugs (e.g. openai/gpt-4o-mini).',
      });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draftProvider,
          model: trimmedModel || activeInfo?.defaultModel || '',
        }),
      });
      const raw = await res.text();
      let parsed: { ok?: boolean; model?: string; latencyMs?: number; error?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }
      if (!res.ok || !parsed.ok) {
        throw new Error(parsed.error || `Connection test failed (${res.status}).`);
      }
      setTestResult({
        ok: true,
        model: parsed.model || trimmedModel || activeInfo?.defaultModel || draftProvider,
        latencyMs: parsed.latencyMs ?? 0,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection test failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  const filteredLiveModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return liveModels.slice(0, 60);
    return liveModels
      .filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [liveModels, modelSearch]);

  const trimmedModel = draftModel.trim();
  const modelValid =
    draftProvider === 'gemini' ||
    (trimmedModel.length > 0 && SAFE_MODEL_RE.test(trimmedModel));

  const handleSave = () => {
    const finalModel = trimmedModel || activeInfo?.defaultModel || DEFAULT_AI_SELECTION.model;
    if (draftProvider !== 'gemini' && !SAFE_MODEL_RE.test(finalModel)) return;
    onSaveSelection({ provider: draftProvider, model: finalModel });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-provider-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-[#12151B] border border-[#232834] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#232834] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Server className="w-4 h-4 text-[#38BDF8] shrink-0" />
            <div className="min-w-0">
              <h2
                id="ai-provider-modal-title"
                className="font-display text-sm font-semibold text-[#E8ECF2] truncate"
              >
                AI Vision Provider
              </h2>
              <p className="text-[11px] text-[#8B95A5] truncate">
                Route Suggest Boxes, Auto-Caption, and Batch Captioning through Gemini, OpenRouter, NanoGPT, or a custom OpenAI-compatible endpoint.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI provider settings"
            className="p-1.5 rounded-md text-[#8B95A5] hover:text-white hover:bg-[#181C24] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Provider Selector Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#CBD5E1]">Select Endpoint</span>
              <button
                type="button"
                onClick={() => void fetchProviderStatus()}
                disabled={loadingProviders}
                className="flex items-center gap-1.5 text-[11px] text-[#8B95A5] hover:text-[#E8ECF2] transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${loadingProviders ? 'animate-spin' : ''}`} />
                <span>Refresh Status</span>
              </button>
            </div>

            {loadError && (
              <div className="p-3 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#FCA5A5] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
                <span>{loadError}</span>
              </div>
            )}

            {loadingProviders && providers.length === 0 ? (
              <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#8B95A5]">
                <Loader2 className="w-4 h-4 animate-spin text-[#38BDF8]" />
                <span>Checking server-configured AI endpoints...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {providers.map((info) => {
                  const selected = draftProvider === info.id;
                  return (
                    <button
                      key={info.id}
                      type="button"
                      onClick={() => handleSelectProvider(info)}
                      className={`text-left p-3 rounded-md border transition-colors ${
                        selected
                          ? 'bg-[#181C24] border-[#38BDF8]'
                          : 'bg-[#0B0D10] border-[#232834] hover:border-[#323949]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#E8ECF2] truncate">
                          {info.name}
                        </span>
                        <span
                          className={`text-[11px] font-mono shrink-0 flex items-center gap-1 ${
                            info.configured ? 'text-[#22C55E]' : 'text-[#F59E0B]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              info.configured ? 'bg-[#22C55E]' : 'bg-[#F59E0B]'
                            }`}
                          />
                          {info.configured ? 'Ready' : 'Needs Secret'}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#8B95A5] mt-1 truncate">
                        {info.endpointDisplay}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Server-Side Secret Setup Guidance (Zero browser API key inputs) */}
          {activeInfo && !activeInfo.configured && (
            <div className="p-3.5 rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#FCD34D]">
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>Server Secret Required for {activeInfo.name}</span>
              </div>
              <p className="text-xs text-[#E8ECF2]/90 leading-relaxed">
                For security, API keys are never stored in your browser. Add the following secret
                {activeInfo.requiredEnvVars.length > 1 ? 's' : ''} in{' '}
                <span className="font-semibold text-white">Settings &rarr; Secrets</span>, then click{' '}
                <span className="font-semibold text-white">Refresh Status</span>:
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {activeInfo.requiredEnvVars.map((envName) => (
                  <code
                    key={envName}
                    className="px-2 py-1 rounded bg-[#0B0D10] border border-[#232834] text-[11px] font-mono text-[#38BDF8]"
                  >
                    {envName}
                  </code>
                ))}
              </div>
              {activeInfo.id === 'custom' && (
                <p className="text-[11px] text-[#8B95A5]">
                  Custom endpoints must use an <code className="font-mono text-[#CBD5E1]">https://</code> OpenAI-compatible base URL (for example{' '}
                  <code className="font-mono text-[#CBD5E1]">https://api.example.com/v1</code>).
                </p>
              )}
            </div>
          )}

          {/* Model Selection */}
          {activeInfo && (
            <div className="p-4 rounded-md bg-[#0B0D10] border border-[#232834] space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label
                    htmlFor="ai-model-slug-input"
                    className="text-xs font-semibold text-[#E8ECF2] block"
                  >
                    Vision Model Slug
                  </label>
                  <p className="text-[11px] text-[#8B95A5]">
                    Choose a vision-capable model for box detection and image captioning.
                  </p>
                </div>
                {draftProvider !== 'gemini' && (
                  <button
                    type="button"
                    disabled={!activeInfo.configured || fetchingModels}
                    onClick={() => void handleFetchLiveModels()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-[11px] font-medium text-[#CBD5E1] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
                  >
                    {fetchingModels ? (
                      <Loader2 className="w-3 h-3 animate-spin text-[#38BDF8]" />
                    ) : (
                      <RefreshCw className="w-3 h-3 text-[#38BDF8]" />
                    )}
                    <span>Fetch Live Models</span>
                  </button>
                )}
              </div>

              <input
                id="ai-model-slug-input"
                type="text"
                value={draftModel}
                onChange={(e) => {
                  setDraftModel(e.target.value);
                  setTestResult(null);
                }}
                disabled={draftProvider === 'gemini'}
                placeholder={activeInfo.defaultModel}
                className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] disabled:opacity-65 rounded-md px-3 py-2 text-xs font-mono text-[#E8ECF2] outline-none"
              />

              {draftProvider === 'gemini' && (
                <p className="text-[11px] text-[#8B95A5]">
                  Built-in Gemini uses automatic resilient fallback from{' '}
                  <span className="font-mono text-[#CBD5E1]">gemini-3.1-flash-lite</span> to{' '}
                  <span className="font-mono text-[#CBD5E1]">gemini-4-hydrogen</span> when busy.
                </p>
              )}

              {draftProvider !== 'gemini' && !modelValid && trimmedModel.length > 0 && (
                <p className="text-[11px] text-[#FCA5A5]">
                  Model ID may only include letters, numbers, and <code className="font-mono">._:/@-</code>.
                </p>
              )}

              {/* Recommended Vision Models */}
              {activeInfo.recommendedModels.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-[#8B95A5] block">
                    Recommended Vision Models
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {activeInfo.recommendedModels.map((m) => {
                      const isPicked = draftModel.trim() === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setDraftModel(m.id);
                            setTestResult(null);
                          }}
                          className={`px-2.5 py-1 rounded border text-[11px] transition-colors text-left ${
                            isPicked
                              ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#E8ECF2]'
                              : 'bg-[#12151B] border-[#232834] text-[#8B95A5] hover:text-[#E8ECF2] hover:border-[#323949]'
                          }`}
                        >
                          <span className="font-medium">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Live Model Browser (when fetched) */}
              {modelsError && (
                <div className="p-2.5 rounded bg-[#EF4444]/10 border border-[#EF4444]/30 text-[11px] text-[#FCA5A5] flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#EF4444]" />
                  <span>{modelsError}</span>
                </div>
              )}

              {liveModels.length > 0 && (
                <div className="pt-2 border-t border-[#232834] space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#8B95A5] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={`Filter ${liveModels.length} models from ${activeInfo.name}...`}
                      className="w-full bg-[#12151B] border border-[#232834] focus:border-[#38BDF8] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#E8ECF2] outline-none"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-[#232834] rounded-md divide-y divide-[#232834] bg-[#12151B]">
                    {filteredLiveModels.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] text-[#8B95A5] text-center">
                        No models match "{modelSearch}".
                      </div>
                    ) : (
                      filteredLiveModels.map((item) => {
                        const isPicked = draftModel.trim() === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setDraftModel(item.id);
                              setTestResult(null);
                            }}
                            className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                              isPicked
                                ? 'bg-[#38BDF8]/15 text-white'
                                : 'text-[#CBD5E1] hover:bg-[#181C24]'
                            }`}
                          >
                            <span className="font-mono text-[11px] truncate">{item.id}</span>
                            {item.name && item.name !== item.id && (
                              <span className="text-[11px] text-[#8B95A5] truncate max-w-[45%] shrink-0">
                                {item.name}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connection Test */}
          {activeInfo && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-md bg-[#0B0D10] border border-[#232834]">
              <div className="min-w-0 flex-1">
                {testResult ? (
                  testResult.ok ? (
                    <div className="flex items-center gap-2 text-xs text-[#22C55E]">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span className="truncate">
                        Connected to <span className="font-mono">{testResult.model}</span>{' '}
                        <span className="font-mono tabular-nums text-[#8B95A5]">
                          ({testResult.latencyMs}ms)
                        </span>
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-xs text-[#FCA5A5]">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
                      <span className="leading-snug">{testResult.error}</span>
                    </div>
                  )
                ) : (
                  <div className="flex items-center gap-2 text-xs text-[#8B95A5]">
                    <Sparkles className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                    <span>Verify server credentials and model responsiveness before saving.</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={!activeInfo.configured || testing || !modelValid}
                onClick={() => void handleTestConnection()}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#E8ECF2] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                ) : (
                  <PlugZap className="w-3.5 h-3.5 text-[#38BDF8]" />
                )}
                <span>{testing ? 'Testing…' : 'Test Connection'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#232834] bg-[#0F1218] flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-[#8B95A5] truncate">
            Active:{' '}
            <span className="font-medium text-[#CBD5E1]">
              {AI_PROVIDER_LABELS[draftProvider]}
            </span>{' '}
            ·{' '}
            <span className="font-mono text-[#E8ECF2]">
              {trimmedModel || activeInfo?.defaultModel || DEFAULT_AI_SELECTION.model}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] text-xs font-medium text-[#CBD5E1] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!modelValid}
              onClick={handleSave}
              className="px-4 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#56C8FA] disabled:opacity-45 text-[#07090C] text-xs font-semibold transition-colors"
            >
              Use Provider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
