import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel, type GenerateContentParameters } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const PRIMARY_AI_MODEL = 'gemini-3.1-flash-lite';
const FALLBACK_AI_MODEL = 'gemini-4-hydrogen';

interface ModelCandidate {
  model: string;
  thinkingLevel?: ThinkingLevel;
  timeoutMs: number;
  usedFallback: boolean;
}

const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    model: PRIMARY_AI_MODEL,
    thinkingLevel: ThinkingLevel.MINIMAL,
    timeoutMs: 32000,
    usedFallback: false,
  },
  {
    model: PRIMARY_AI_MODEL,
    thinkingLevel: ThinkingLevel.MINIMAL,
    timeoutMs: 25000,
    usedFallback: false,
  },
  {
    model: FALLBACK_AI_MODEL,
    thinkingLevel: ThinkingLevel.LOW,
    timeoutMs: 25000,
    usedFallback: true,
  },
];

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check your key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseReadableErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Not raw JSON
  }
  return raw;
}

function isRetryableModelError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('503') ||
    raw.includes('500') ||
    raw.includes('404') ||
    raw.includes('NOT_FOUND') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('DEADLINE_EXCEEDED') ||
    raw.includes('timed out') ||
    raw.includes('AbortError') ||
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('429')
  );
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const readable = parseReadableErrorMessage(raw);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message:
        'Gemini API access denied or key invalid. Please check your API key in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('Quota exceeded') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini API free-tier quota reached (429). Wait a minute for the limit to reset, or select a billing-enabled API key in Settings > Secrets.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return {
      // Return 429 instead of 503 so reverse proxies do not intercept 503 with an HTML splash page
      status: 429,
      message:
        'Gemini is temporarily experiencing high demand. Please wait a few seconds and try again.',
    };
  }
  if (raw.includes('timed out')) {
    return {
      // Return 408 instead of 504 so reverse proxies preserve our JSON error payload
      status: 408,
      message: 'AI request timed out while waiting for Gemini. Please try again.',
    };
  }
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 400, message: raw };
  }
  return {
    status: 500,
    message: readable || 'AI request failed unexpectedly.',
  };
}

async function generateContentWithTimeout(
  ai: GoogleGenAI,
  params: GenerateContentParameters,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await ai.models.generateContent({
      ...params,
      config: {
        ...params.config,
        abortSignal: controller.signal,
      },
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Model ${params.model} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Tries primary model (gemini-3.1-flash-lite), then falls back to gemini-4-hydrogen
 * on transient overload or unavailability.
 */
async function generateWithResilience(
  ai: GoogleGenAI,
  buildParams: (model: string, thinkingLevel?: ThinkingLevel) => GenerateContentParameters
) {
  let lastError: unknown = null;
  const attempts: string[] = [];

  for (let i = 0; i < MODEL_CANDIDATES.length; i++) {
    const candidate = MODEL_CANDIDATES[i];
    if (i > 0) {
      await new Promise((r) => setTimeout(r, i * 1000));
    }
    try {
      const response = await generateContentWithTimeout(
        ai,
        buildParams(candidate.model, candidate.thinkingLevel),
        candidate.timeoutMs
      );
      return {
        response,
        modelUsed: candidate.model,
        usedFallback: candidate.usedFallback,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const readable = parseReadableErrorMessage(msg);
      attempts.push(`${candidate.model}: ${readable}`);
      console.error(`[Reticle AI] Model ${candidate.model} failed:`, readable.slice(0, 240));
      if (!isRetryableModelError(err)) {
        throw err;
      }
    }
  }

  const combined = new Error(attempts.join(' | ') || (lastError instanceof Error ? lastError.message : 'All Gemini models failed.'));
  throw combined;
}

// ---------------- OpenAI-Compatible Providers (OpenRouter, NanoGPT, Custom) ----------------

type AIProviderId = 'gemini' | 'openrouter' | 'nanogpt' | 'custom';

const SAFE_MODEL_RE = /^[a-zA-Z0-9._:/@-]{1,128}$/;

function isBlockedPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '::' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  // IPv4 literal checks (loopback, RFC1918, link-local / cloud metadata, CGNAT)
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }
  // IPv6 private / link-local ranges
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
    return true;
  }
  return false;
}

function validateSafeHttpsBaseUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'https:') {
    throw new Error('Custom OpenAI-compatible endpoint must use HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Endpoint URL must not embed credentials.');
  }
  if (isBlockedPrivateHost(parsed.hostname)) {
    throw new Error('Endpoint host is not permitted.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

interface ResolvedOpenAICompatibleConfig {
  provider: Exclude<AIProviderId, 'gemini'>;
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
}

const PROVIDER_PRESETS = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash-lite',
    recommendedModels: [
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Fast Vision)' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'qwen/qwen2.5-vl-72b-instruct', label: 'Qwen 2.5 VL 72B' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
    ],
  },
  nanogpt: {
    name: 'NanoGPT',
    baseUrl: 'https://nano-gpt.com/api/v1',
    defaultModel: 'gemini-2.5-flash-lite',
    recommendedModels: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'qwen2.5-vl-72b-instruct', label: 'Qwen 2.5 VL 72B' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
  },
} as const;

function getProviderStatuses() {
  const customBaseRaw = (process.env.OPENAI_COMPATIBLE_BASE_URL || '').trim();
  let customBaseValid = '';
  if (customBaseRaw) {
    try {
      customBaseValid = validateSafeHttpsBaseUrl(customBaseRaw);
    } catch {
      customBaseValid = '';
    }
  }

  return [
    {
      id: 'gemini' as const,
      name: 'Gemini (Built-in)',
      endpointDisplay: 'Google Gemini API',
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      requiredEnvVars: ['GEMINI_API_KEY'],
      defaultModel: PRIMARY_AI_MODEL,
      recommendedModels: [
        { id: PRIMARY_AI_MODEL, label: 'Gemini 3.1 Flash Lite (Primary)' },
        { id: FALLBACK_AI_MODEL, label: 'Gemini 4 Flash (Hydrogen)' },
      ],
    },
    {
      id: 'openrouter' as const,
      name: 'OpenRouter',
      endpointDisplay: PROVIDER_PRESETS.openrouter.baseUrl,
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      requiredEnvVars: ['OPENROUTER_API_KEY'],
      defaultModel: PROVIDER_PRESETS.openrouter.defaultModel,
      recommendedModels: [...PROVIDER_PRESETS.openrouter.recommendedModels],
    },
    {
      id: 'nanogpt' as const,
      name: 'NanoGPT',
      endpointDisplay: PROVIDER_PRESETS.nanogpt.baseUrl,
      configured: Boolean(process.env.NANOGPT_API_KEY?.trim()),
      requiredEnvVars: ['NANOGPT_API_KEY'],
      defaultModel: PROVIDER_PRESETS.nanogpt.defaultModel,
      recommendedModels: [...PROVIDER_PRESETS.nanogpt.recommendedModels],
    },
    {
      id: 'custom' as const,
      name: 'Custom OpenAI-Compatible',
      endpointDisplay: customBaseValid || 'Set OPENAI_COMPATIBLE_BASE_URL in Secrets',
      configured: Boolean(customBaseValid && process.env.OPENAI_COMPATIBLE_API_KEY?.trim()),
      requiredEnvVars: ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY'],
      defaultModel: (process.env.OPENAI_COMPATIBLE_MODEL || '').trim() || 'gpt-4o-mini',
      recommendedModels: (process.env.OPENAI_COMPATIBLE_MODEL || '').trim()
        ? [{ id: process.env.OPENAI_COMPATIBLE_MODEL!.trim(), label: 'Configured Default Model' }]
        : [{ id: 'gpt-4o-mini', label: 'gpt-4o-mini' }],
    },
  ];
}

function resolveOpenAICompatibleConfig(
  provider: Exclude<AIProviderId, 'gemini'>,
  requestedModel?: string
): ResolvedOpenAICompatibleConfig {
  const cleanModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (cleanModel && !SAFE_MODEL_RE.test(cleanModel)) {
    throw new Error('Invalid model identifier format.');
  }

  if (provider === 'openrouter') {
    const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is not configured. Add it in Settings > Secrets to use OpenRouter.'
      );
    }
    return {
      provider,
      baseUrl: PROVIDER_PRESETS.openrouter.baseUrl,
      apiKey,
      model: cleanModel || PROVIDER_PRESETS.openrouter.defaultModel,
      extraHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'https://reticle.studio',
        'X-Title': 'Reticle ML Studio',
      },
    };
  }

  if (provider === 'nanogpt') {
    const apiKey = (process.env.NANOGPT_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error(
        'NANOGPT_API_KEY is not configured. Add it in Settings > Secrets to use NanoGPT.'
      );
    }
    return {
      provider,
      baseUrl: PROVIDER_PRESETS.nanogpt.baseUrl,
      apiKey,
      model: cleanModel || PROVIDER_PRESETS.nanogpt.defaultModel,
      extraHeaders: {},
    };
  }

  // 'custom' — strictly read URL and API key from server env (never arbitrary client URLs)
  const rawBase = (process.env.OPENAI_COMPATIBLE_BASE_URL || '').trim();
  const apiKey = (process.env.OPENAI_COMPATIBLE_API_KEY || '').trim();
  if (!rawBase || !apiKey) {
    throw new Error(
      'Custom endpoint requires OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_API_KEY in Settings > Secrets.'
    );
  }
  const baseUrl = validateSafeHttpsBaseUrl(rawBase);
  return {
    provider,
    baseUrl,
    apiKey,
    model: cleanModel || (process.env.OPENAI_COMPATIBLE_MODEL || '').trim() || 'gpt-4o-mini',
    extraHeaders: {},
  };
}

function extractJsonObject<T>(rawText: string, fallback: T): T {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!stripped) return fallback;
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Attempt extracting the outermost JSON object if the model added prose around it
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Model returned non-JSON output.');
  }
}

async function callOpenAICompatibleChat(params: {
  config: ResolvedOpenAICompatibleConfig;
  systemPrompt: string;
  userPrompt: string;
  imageBase64?: string;
  mimeType?: string;
  requireJson?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const {
    config,
    systemPrompt,
    userPrompt,
    imageBase64,
    mimeType = 'image/jpeg',
    requireJson = true,
    timeoutMs = 38000,
  } = params;

  const SAFE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const safeMime = SAFE_IMAGE_MIMES.has(mimeType) ? mimeType : 'image/jpeg';

  const userContent = imageBase64
    ? [
        { type: 'text', text: userPrompt },
        {
          type: 'image_url',
          image_url: { url: `data:${safeMime};base64,${imageBase64}` },
        },
      ]
    : userPrompt;

  const sendOnce = async (useResponseFormat: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
      };
      if (useResponseFormat) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          ...config.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await res.text();
      return { res, raw };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Model ${config.model} timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  let attempt = await sendOnce(requireJson);
  // Some OpenRouter/NanoGPT vision models reject response_format: json_object with HTTP 400
  if (requireJson && attempt.res.status === 400 && attempt.raw.toLowerCase().includes('response_format')) {
    attempt = await sendOnce(false);
  }

  if (!attempt.res.ok) {
    let readable = attempt.raw.slice(0, 260);
    try {
      const parsedErr = JSON.parse(attempt.raw) as { error?: { message?: string } | string };
      if (typeof parsedErr.error === 'string') readable = parsedErr.error;
      else if (parsedErr.error?.message) readable = parsedErr.error.message;
    } catch {
      // Keep raw excerpt
    }
    throw new Error(`${config.provider} (${attempt.res.status}): ${readable}`);
  }

  const parsed = JSON.parse(attempt.raw) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }
  return '';
}

function normalizeProvider(raw: unknown): AIProviderId {
  if (raw === 'openrouter' || raw === 'nanogpt' || raw === 'custom') return raw;
  return 'gemini';
}

function formatOpenAICompatibleError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.includes('not configured') ||
    raw.includes('requires OPENAI_COMPATIBLE') ||
    raw.includes('Invalid model identifier') ||
    raw.includes('must use HTTPS') ||
    raw.includes('must not embed credentials') ||
    raw.includes('host is not permitted')
  ) {
    return { status: 400, message: raw };
  }
  if (raw.includes('(401)') || raw.includes('(403)')) {
    return {
      status: 403,
      message: `Provider authentication failed. Verify your API key in Settings > Secrets. (${raw})`,
    };
  }
  if (raw.includes('(429)') || raw.includes('(503)') || raw.includes('(502)')) {
    return {
      status: 429,
      message: `Upstream provider is busy or rate-limited. ${raw}`,
    };
  }
  if (raw.includes('timed out')) {
    return { status: 408, message: raw };
  }
  return { status: 500, message: raw || 'OpenAI-compatible AI request failed.' };
}

interface TaxonomyGroupInput {
  className: string;
  objects: string[];
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, model: PRIMARY_AI_MODEL, fallbackModel: FALLBACK_AI_MODEL });
  });

  // List available AI providers and non-secret configuration status
  app.get('/api/ai/providers', (_req, res) => {
    res.json({ providers: getProviderStatuses() });
  });

  // Fetch live models list from an OpenAI-compatible provider (OpenRouter, NanoGPT, Custom)
  app.post('/api/ai/models', async (req, res) => {
    try {
      const provider = normalizeProvider((req.body as { provider?: unknown })?.provider);
      if (provider === 'gemini') {
        const geminiInfo = getProviderStatuses().find((p) => p.id === 'gemini');
        res.json({
          models: (geminiInfo?.recommendedModels ?? []).map((m) => ({ id: m.id, name: m.label })),
        });
        return;
      }

      const config = resolveOpenAICompatibleConfig(provider);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const upstream = await fetch(`${config.baseUrl}/models`, {
          method: 'GET',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            ...config.extraHeaders,
          },
          signal: controller.signal,
        });
        const raw = await upstream.text();
        if (!upstream.ok) {
          throw new Error(`${provider} (${upstream.status}): ${raw.slice(0, 180)}`);
        }
        const parsed = JSON.parse(raw) as {
          data?: Array<{ id?: string; name?: string }>;
        };
        const models = (parsed.data ?? [])
          .filter((m) => typeof m.id === 'string' && m.id.trim().length > 0)
          .map((m) => ({
            id: m.id!.trim(),
            name: (m.name || m.id || '').trim(),
          }))
          .slice(0, 250);
        res.json({ models });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const { status, message } = formatOpenAICompatibleError(err);
      res.status(status).json({ error: message });
    }
  });

  // Test connection to selected AI provider & model
  app.post('/api/ai/test', async (req, res) => {
    const started = Date.now();
    try {
      const { provider: rawProvider, model } = (req.body ?? {}) as {
        provider?: unknown;
        model?: string;
      };
      const provider = normalizeProvider(rawProvider);

      if (provider === 'gemini') {
        const ai = createGeminiClient();
        const { modelUsed } = await generateWithResilience(ai, (m, thinkingLevel) => ({
          model: m,
          contents: 'Reply with the single word OK.',
          config: thinkingLevel ? { thinkingConfig: { thinkingLevel } } : undefined,
        }));
        res.json({ ok: true, provider, model: modelUsed, latencyMs: Date.now() - started });
        return;
      }

      const config = resolveOpenAICompatibleConfig(provider, model);
      await callOpenAICompatibleChat({
        config,
        systemPrompt: 'Reply concisely.',
        userPrompt: 'Respond with JSON: {"status":"ok"}',
        requireJson: false,
        timeoutMs: 20000,
      });
      res.json({ ok: true, provider, model: config.model, latencyMs: Date.now() - started });
    } catch (err) {
      const provider = normalizeProvider((req.body as { provider?: unknown })?.provider);
      const formatted =
        provider === 'gemini' ? formatGeminiError(err) : formatOpenAICompatibleError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // AI Object Box Suggestions mapped to hierarchical Class -> Object taxonomy
  app.post('/api/ai/detect', async (req, res) => {
    const provider = normalizeProvider((req.body as { provider?: unknown })?.provider);
    try {
      const { imageBase64, mimeType, taxonomy, model: requestedModel } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        taxonomy?: TaxonomyGroupInput[];
        model?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Missing imageBase64 payload.' });
        return;
      }

      const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

      const taxonomySummary =
        Array.isArray(taxonomy) && taxonomy.length > 0
          ? taxonomy
              .map((g) => `- Class "${g.className}": [${g.objects.join(', ')}]`)
              .join('\n')
          : '- Use concise general parent classes (e.g., Body, Clothes, Accessories, Vehicle) and specific child objects.';

      const prompt = [
        'You are a precision computer vision dataset labeling assistant.',
        'Detect clearly visible objects in the image and return tight, accurate 2D bounding boxes.',
        'Use the project hierarchical Class -> Object taxonomy below whenever an item matches:',
        taxonomySummary,
        'Rules:',
        '1. Return box_2d as [ymin, xmin, ymax, xmax] normalized to integer coordinates from 0 to 1000.',
        '2. Prefer exact className and objectName names from the taxonomy above. If a prominent object does not fit any existing object name, pick the closest existing className (or a clean new parent class) and a concise singular objectName.',
        '3. Provide a calibrated confidence score between 0.35 and 0.99.',
        '4. Return up to 15 high-confidence, non-duplicate detections.',
      ].join('\n');

      let rawText = '{"detections":[]}';
      let modelUsed = PRIMARY_AI_MODEL;
      let usedFallback = false;

      if (provider !== 'gemini') {
        const config = resolveOpenAICompatibleConfig(provider, requestedModel);
        modelUsed = config.model;
        rawText = await callOpenAICompatibleChat({
          config,
          systemPrompt:
            'You are a computer vision object detection engine. Always output strictly valid JSON matching {"detections":[{"className":"string","objectName":"string","box_2d":[ymin,xmin,ymax,xmax],"confidence":0.9}]} with no markdown fences or extra commentary.',
          userPrompt: `${prompt}\n\nReturn ONLY a JSON object with key "detections".`,
          imageBase64,
          mimeType: safeMime,
          requireJson: true,
        });
      } else {
        const ai = createGeminiClient();
        const result = await generateWithResilience(ai, (model, thinkingLevel) => ({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: safeMime,
                  data: imageBase64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      className: {
                        type: Type.STRING,
                        description: 'Parent class name from taxonomy (e.g., Body, Clothes).',
                      },
                      objectName: {
                        type: Type.STRING,
                        description: 'Specific child object name (e.g., Hand, Dress).',
                      },
                      box_2d: {
                        type: Type.ARRAY,
                        items: { type: Type.INTEGER },
                        description: '[ymin, xmin, ymax, xmax] normalized 0 to 1000.',
                      },
                      confidence: {
                        type: Type.NUMBER,
                        description: 'Detection confidence from 0.0 to 1.0.',
                      },
                    },
                    required: ['className', 'objectName', 'box_2d', 'confidence'],
                  },
                },
              },
              required: ['detections'],
            },
          },
        }));
        rawText = (result.response.text ?? '{"detections":[]}').trim();
        modelUsed = result.modelUsed;
        usedFallback = result.usedFallback;
      }

      const parsed = extractJsonObject<{
        detections?: Array<{
          className: string;
          objectName: string;
          box_2d: number[];
          confidence: number;
        }>;
      }>(rawText, { detections: [] });

      const cleaned = (parsed.detections ?? [])
        .filter(
          (d) =>
            d &&
            typeof d.className === 'string' &&
            typeof d.objectName === 'string' &&
            Array.isArray(d.box_2d) &&
            d.box_2d.length === 4
        )
        .map((d) => {
          const [y1, x1, y2, x2] = d.box_2d.map((n) => Math.max(0, Math.min(1000, Math.round(n))));
          const ymin = Math.min(y1, y2);
          const ymax = Math.max(y1, y2);
          const xmin = Math.min(x1, x2);
          const xmax = Math.max(x1, x2);
          return {
            className: d.className.trim(),
            objectName: d.objectName.trim(),
            box_2d: [ymin, xmin, ymax, xmax] as [number, number, number, number],
            confidence: Math.max(0.1, Math.min(1, Number(d.confidence) || 0.75)),
          };
        })
        .filter((d) => d.box_2d[2] - d.box_2d[0] >= 8 && d.box_2d[3] - d.box_2d[1] >= 8);

      res.json({ detections: cleaned, provider, model: modelUsed, usedFallback });
    } catch (err) {
      const { status, message } =
        provider === 'gemini' ? formatGeminiError(err) : formatOpenAICompatibleError(err);
      const details = err instanceof Error ? err.message.slice(0, 500) : undefined;
      res.status(status).json({ error: message, details });
    }
  });

  // AI Auto-Captioning & Tag Suggestions
  app.post('/api/ai/caption', async (req, res) => {
    const provider = normalizeProvider((req.body as { provider?: unknown })?.provider);
    try {
      const { imageBase64, mimeType, style, existingLabels, model: requestedModel } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        style?: 'descriptive' | 'concise' | 'technical';
        existingLabels?: string[];
        model?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Missing imageBase64 payload.' });
        return;
      }

      const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

      const styleInstruction =
        style === 'concise'
          ? 'Write a crisp, factual 1-sentence primary caption suitable for COCO/CLIP image-text training.'
          : style === 'technical'
            ? 'Write a precise, objective computer-vision caption detailing subject pose, garments/objects, spatial layout, camera angle, and lighting for VLM fine-tuning.'
            : 'Write a rich, natural 2-3 sentence descriptive caption covering subjects, attire, actions, objects, and setting without speculation.';

      const labelHint =
        Array.isArray(existingLabels) && existingLabels.length > 0
          ? `Already annotated hierarchical labels in this image: ${existingLabels.join(', ')}. Incorporate visible annotated entities accurately.`
          : '';

      const prompt = [
        'You are a machine learning dataset captioning assistant.',
        styleInstruction,
        labelHint,
        'Also produce:',
        '- shortCaption: A concise 8-14 word summary phrase.',
        '- tags: 4 to 8 lowercase hyphenated or single-word dataset tags (e.g., "studio-lighting", "full-body", "daytime", "hand-detail").',
      ]
        .filter(Boolean)
        .join('\n');

      let rawText = '{}';
      let modelUsed = PRIMARY_AI_MODEL;
      let usedFallback = false;

      if (provider !== 'gemini') {
        const config = resolveOpenAICompatibleConfig(provider, requestedModel);
        modelUsed = config.model;
        rawText = await callOpenAICompatibleChat({
          config,
          systemPrompt:
            'You are a machine learning dataset captioning engine. Return strictly valid JSON with keys {"caption":"string","shortCaption":"string","tags":["tag1","tag2"]} and no markdown fences or extra prose.',
          userPrompt: `${prompt}\n\nReturn ONLY a valid JSON object with keys "caption", "shortCaption", and "tags".`,
          imageBase64,
          mimeType: safeMime,
          requireJson: true,
        });
      } else {
        const ai = createGeminiClient();
        const result = await generateWithResilience(ai, (model, thinkingLevel) => ({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: safeMime,
                  data: imageBase64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                caption: {
                  type: Type.STRING,
                  description: 'Primary ML training caption for the image.',
                },
                shortCaption: {
                  type: Type.STRING,
                  description: 'Concise 8-14 word caption.',
                },
                tags: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '4-8 concise lowercase dataset classification tags.',
                },
              },
              required: ['caption', 'shortCaption', 'tags'],
            },
          },
        }));
        rawText = (result.response.text ?? '{}').trim();
        modelUsed = result.modelUsed;
        usedFallback = result.usedFallback;
      }

      const parsed = extractJsonObject<{
        caption?: string;
        shortCaption?: string;
        tags?: string[];
      }>(rawText, {});

      res.json({
        caption: (parsed.caption ?? '').trim(),
        shortCaption: (parsed.shortCaption ?? '').trim(),
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
          : [],
        provider,
        model: modelUsed,
        usedFallback,
      });
    } catch (err) {
      const { status, message } =
        provider === 'gemini' ? formatGeminiError(err) : formatOpenAICompatibleError(err);
      const details = err instanceof Error ? err.message.slice(0, 500) : undefined;
      res.status(status).json({ error: message, details });
    }
  });

  // Never let unmatched /api/* requests fall through to SPA index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Ensure Express body-parser / middleware errors on /api/* return JSON, never HTML
  app.use(
    (
      err: Error & { status?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api')) {
        const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
        const message =
          err.type === 'entity.too.large'
            ? 'Image payload is too large for the AI endpoint.'
            : err.message || 'Unexpected server error.';
        res.status(status).json({ error: message });
        return;
      }
      next(err);
    }
  );

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true' || Boolean(process.env.K_SERVICE);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: disableHmr ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Reticle studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Reticle server:', err);
  process.exit(1);
});
