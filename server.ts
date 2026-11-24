import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel, type GenerateContentParameters } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const PRIMARY_AI_MODEL = 'gemini-3.1-flash-lite';
const FALLBACK_AI_MODEL = 'gemini-4-hydrogen';

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

function isTransientOverloadError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('DEADLINE_EXCEEDED') ||
    raw.includes('timed out') ||
    raw.includes('AbortError')
  );
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const readable = parseReadableErrorMessage(raw);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message:
        'Gemini API access denied or key invalid. Please verify your API key in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini API quota reached (429). Please wait a moment or check your API key quota in Settings > Secrets.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return {
      // Return 429 instead of 503 so reverse proxies do not intercept 503 with an HTML splash page
      status: 429,
      message:
        'Gemini is temporarily busy due to high demand. Please wait a few seconds and try again.',
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

function parseModelJson<T>(rawText: string, fallback: T): T {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!stripped) return fallback;
  return JSON.parse(stripped) as T;
}

/**
 * Calls primary model (gemini-3.1-flash-lite) with a 15s timeout.
 * If primary is temporarily overloaded (503 UNAVAILABLE) or stalls, retries with backoff
 * and falls back to gemini-4-hydrogen (fast Gemini Flash) so labeling completes reliably.
 */
async function generateWithResilience(
  ai: GoogleGenAI,
  buildParams: (model: string, thinkingLevel: ThinkingLevel) => GenerateContentParameters
) {
  try {
    const response = await generateContentWithTimeout(
      ai,
      buildParams(PRIMARY_AI_MODEL, ThinkingLevel.MINIMAL),
      15000
    );
    return { response, modelUsed: PRIMARY_AI_MODEL, usedFallback: false };
  } catch (primaryErr) {
    if (!isTransientOverloadError(primaryErr)) {
      throw primaryErr;
    }
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const response = await generateContentWithTimeout(
        ai,
        buildParams(FALLBACK_AI_MODEL, ThinkingLevel.LOW),
        18000
      );
      return { response, modelUsed: FALLBACK_AI_MODEL, usedFallback: true };
    } catch (fallbackErr) {
      if (!isTransientOverloadError(fallbackErr)) {
        throw fallbackErr;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const response = await generateContentWithTimeout(
        ai,
        buildParams(PRIMARY_AI_MODEL, ThinkingLevel.MINIMAL),
        15000
      );
      return { response, modelUsed: PRIMARY_AI_MODEL, usedFallback: false };
    }
  }
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

  // AI Object Box Suggestions mapped to hierarchical Class -> Object taxonomy
  app.post('/api/ai/detect', async (req, res) => {
    try {
      const { imageBase64, mimeType, taxonomy } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        taxonomy?: TaxonomyGroupInput[];
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Missing imageBase64 payload.' });
        return;
      }

      const ai = createGeminiClient();
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

      const { response, modelUsed, usedFallback } = await generateWithResilience(
        ai,
        (model, thinkingLevel) => ({
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
            thinkingConfig: { thinkingLevel },
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
        })
      );

      const rawText = (response.text ?? '{"detections":[]}').trim();
      const parsed = parseModelJson<{
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

      res.json({ detections: cleaned, model: modelUsed, usedFallback });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // AI Auto-Captioning & Tag Suggestions
  app.post('/api/ai/caption', async (req, res) => {
    try {
      const { imageBase64, mimeType, style, existingLabels } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        style?: 'descriptive' | 'concise' | 'technical';
        existingLabels?: string[];
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Missing imageBase64 payload.' });
        return;
      }

      const ai = createGeminiClient();
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

      const { response, modelUsed, usedFallback } = await generateWithResilience(
        ai,
        (model, thinkingLevel) => ({
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
            thinkingConfig: { thinkingLevel },
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
        })
      );

      const rawText = (response.text ?? '{}').trim();
      const parsed = parseModelJson<{
        caption?: string;
        shortCaption?: string;
        tags?: string[];
      }>(rawText, {});

      res.json({
        caption: (parsed.caption ?? '').trim(),
        shortCaption: (parsed.shortCaption ?? '').trim(),
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
          : [],
        model: modelUsed,
        usedFallback,
      });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
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

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Reticle studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Reticle server:', err);
  process.exit(1);
});
