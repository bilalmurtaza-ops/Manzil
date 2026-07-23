import { getSubject } from '../data/syllabus';
import type { ChatMessage, StudentProfile } from './types';

/**
 * Gemini service layer. All AI features flow through here.
 *
 * The key ships in the client for the contest build (EXPO_PUBLIC_GEMINI_API_KEY);
 * production would proxy these calls through a tiny server. Every response that
 * feeds app logic uses JSON mode with a response schema, never free text.
 *
 * Ordered fallback chains, not a single model — each entry draws from an
 * independent daily-quota pool, so a request only fails if every model in
 * the chain is simultaneously exhausted or down. Ordering was chosen from
 * measured latency, not guesswork (see gemini-model-notes in project history):
 *
 *  VISION_CHAIN — for calls that combine an image with a JSON response
 *  schema (answer grading, snap-to-study, image messages to Ustaad). Lite
 *  tiers measured ~11x slower on this specific combination (114s vs ~10-13s),
 *  so the two low-quota-but-fast Flash models go first and the
 *  high-quota-but-slow Lite model is the last-resort safety net:
 *    1. gemini-3.5-flash       20 RPD  — fastest measured (~10-13s)
 *    2. gemini-3.6-flash       20 RPD  — independent quota pool, same speed
 *    3. gemini-3.5-flash-lite 500 RPD  — slow (~114s) but effectively unlimited
 *
 *  TEXT_CHAIN — for plain text or text + JSON schema (chat, quiz generation,
 *  session tips). All three are fast here, so order is by daily quota
 *  headroom — the failure mode being guarded against is running out of
 *  requests, not latency:
 *    1. gemini-3.5-flash-lite 500 RPD
 *    2. gemini-3.1-flash-lite 500 RPD  — independent quota pool
 *    3. gemini-3.5-flash       20 RPD  — last resort, still fast for text
 */

const VISION_CHAIN = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const TEXT_CHAIN = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];

/**
 * Sent as systemInstruction on every call so Gemini never has to infer who
 * it's talking to from board-specific jargon alone — "board exam" and
 * similar terms aren't unique to Pakistan (India's CBSE uses nearly
 * identical vocabulary, and English-language South Asian ed-content online
 * skews Indian), so this removes a real ambiguity rather than a
 * hypothetical one. Measured overhead: ~60-70 tokens/request against a
 * 250K TPM budget — negligible. Verified it doesn't trigger extra safety
 * filtering on sensitive-but-legitimate syllabus content (e.g. the Biology
 * "Reproduction" chapter) before shipping this.
 */
const APP_CONTEXT =
  'This request comes from Manzil, a study-planning app used by students in Pakistan preparing for their Matriculation (SSC, Class 9-10) board exams under the Punjab Boards of Intermediate and Secondary Education (BISE), following the PCTB curriculum. Ground every answer in this exact context.';

const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'offline' | 'key' | 'api' | 'parse',
  ) {
    super(message);
  }
}

interface Part {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GenerateOptions {
  system?: string;
  /** JSON schema for structured output. */
  responseSchema?: object;
  temperature?: number;
  maxOutputTokens?: number;
  /** Defaults to TEXT_CHAIN[0]. */
  model?: string;
}

async function generate(
  contents: { role: 'user' | 'model'; parts: Part[] }[],
  options: GenerateOptions = {},
): Promise<string> {
  if (!API_KEY) {
    throw new GeminiError('AI key missing. Add EXPO_PUBLIC_GEMINI_API_KEY to .env and rebuild.', 'key');
  }
  const model = options.model ?? TEXT_CHAIN[0];
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.6,
      maxOutputTokens: options.maxOutputTokens ?? 4096,
      ...(options.responseSchema
        ? { responseMimeType: 'application/json', responseSchema: options.responseSchema }
        : {}),
    },
  };
  if (options.system) {
    body.systemInstruction = { parts: [{ text: options.system }] };
  }

  let res: Response;
  try {
    res = await fetch(`${endpointFor(model)}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GeminiError(
      'No internet connection. Your plan and saved content still work offline.',
      'offline',
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 && text.includes('API key')) {
      throw new GeminiError('The AI key looks invalid. Check EXPO_PUBLIC_GEMINI_API_KEY.', 'key');
    }
    throw new GeminiError(`AI request failed (${res.status}). Try again in a moment.`, 'api');
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new GeminiError('AI returned an empty response. Try again.', 'api');
  return text;
}

/**
 * Walks a model chain in order, moving to the next model on any API-level
 * failure (quota exhausted, transient 5xx) so a request only fails once
 * every model in the chain is unavailable. Never retries 'key', 'offline'
 * or 'parse' failures — those fail identically on every model, so retrying
 * would only add latency before the same error.
 */
async function generateChain(
  chain: string[],
  contents: { role: 'user' | 'model'; parts: Part[] }[],
  options: GenerateOptions = {},
): Promise<string> {
  let lastError: unknown;
  for (const model of chain) {
    try {
      return await generate(contents, { ...options, model });
    } catch (e) {
      lastError = e;
      if (!(e instanceof GeminiError && e.kind === 'api')) throw e;
      // else: this model is exhausted/down — fall through to the next one
    }
  }
  throw lastError;
}

const generateText = (
  contents: { role: 'user' | 'model'; parts: Part[] }[],
  options: GenerateOptions = {},
) => generateChain(TEXT_CHAIN, contents, options);

const generateVision = (
  contents: { role: 'user' | 'model'; parts: Part[] }[],
  options: GenerateOptions = {},
) => generateChain(VISION_CHAIN, contents, options);

function profileContext(profile: StudentProfile): string {
  const subject = (id: string) => getSubject(id)?.name ?? id;
  const weak = Object.entries(profile.confidence)
    .filter(([, v]) => v <= 2)
    .map(([id]) => subject(id));
  return [
    `Student: ${profile.name}, Class ${profile.classLevel} (SSC ${profile.classLevel === '9' ? 'Part I' : 'Part II'}), ${
      profile.group === 'arts' ? 'Arts group' : profile.group === 'science-bio' ? 'Science (Biology)' : 'Science (Computer Science)'
    }, Punjab Board (${profile.boardId}).`,
    `Board exams start ${profile.examDate}. Daily study time: ${profile.dailyMinutes} minutes.`,
    weak.length > 0 ? `Self-rated weak subjects: ${weak.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const USTAAD_SYSTEM = (profile: StudentProfile) => `
${APP_CONTEXT}

You are "Ustaad" (استاد), the personal AI tutor inside this app. ${profileContext(profile)}

Rules:
- Match the student's language. If they write in Urdu script reply in Urdu; if Roman Urdu, reply in Roman Urdu; if English, reply in simple English. Mixing Urdu terms into English answers is encouraged — that is how Pakistani teachers actually talk.
- You know the PCTB (Punjab Textbook Board) syllabus, board paper patterns and pairing schemes. Answers must match what earns marks in board exams: definitions, labelled points, solved steps.
- When asked for a "board-style" or N-mark answer, produce exactly the structure an examiner rewards: numbered points for long questions, 2-3 crisp lines for short questions.
- Be warm and encouraging like a favourite teacher, never preachy. Keep answers tight; expand only when asked.
- If a question is outside studies, gently bring the student back to their preparation.
- Use plain text only - never use markdown formatting like **bold**, *italic*, or # headings. Structure answers with numbered lines and simple dashes instead.
`;

export async function askUstaad(
  profile: StudentProfile,
  history: ChatMessage[],
  message: string,
  imageBase64?: string,
): Promise<string> {
  const contents = [
    ...history.slice(-12).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }] as Part[],
    })),
    {
      role: 'user' as const,
      parts: [
        ...(imageBase64
          ? [{ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }]
          : []),
        { text: message },
      ] as Part[],
    },
  ];
  const options = { system: USTAAD_SYSTEM(profile), temperature: 0.7 };
  // Only the image case needs the vision chain; plain text chat is already
  // fast on the text chain and shouldn't spend the lower vision-tier quota.
  return imageBase64 ? generateVision(contents, options) : generateText(contents, options);
}

// ---------- Quiz generation ----------

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

export async function generateQuiz(
  profile: StudentProfile,
  subjectId: string,
  chapterName: string,
  count = 8,
): Promise<QuizQuestion[]> {
  const subject = getSubject(subjectId);
  const pattern = subject?.pattern[profile.classLevel] ?? '';
  const text = await generateText(
    [
      {
        role: 'user',
        parts: [
          {
            text: `Create ${count} board-style MCQs for Punjab Board Class ${profile.classLevel} ${subject?.name ?? subjectId}, chapter "${chapterName}".
Paper pattern context: ${pattern}
Style: exactly like BISE board objective papers — one correct option, three plausible distractors drawn from common student mistakes. Cover different topics of the chapter. Each option must be short. "explanation" is 1-2 lines teaching why the answer is right, in simple English with Urdu terms where natural. If the subject is Urdu or Islamiat, write questions and options in Urdu script.`,
          },
        ],
      },
    ],
    { system: APP_CONTEXT, responseSchema: QUIZ_SCHEMA, temperature: 0.8 },
  );
  try {
    const parsed = JSON.parse(text) as { questions: QuizQuestion[] };
    const valid = parsed.questions.filter(
      (q) =>
        q.options?.length === 4 && q.correctIndex >= 0 && q.correctIndex < 4 && q.question,
    );
    if (valid.length === 0) throw new Error('empty');
    return valid;
  } catch {
    throw new GeminiError('Could not build the quiz. Try again.', 'parse');
  }
}

// ---------- Written answer grading ----------

export interface AnswerGrade {
  marksAwarded: number;
  marksTotal: number;
  strengths: string[];
  improvements: string[];
  examinerNote: string;
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    marksAwarded: { type: 'number' },
    marksTotal: { type: 'number' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    examinerNote: { type: 'string' },
  },
  required: ['marksAwarded', 'marksTotal', 'strengths', 'improvements', 'examinerNote'],
};

export async function gradeAnswer(
  profile: StudentProfile,
  imageBase64: string,
  subjectId: string,
  marksTotal: number,
): Promise<AnswerGrade> {
  const subject = getSubject(subjectId);
  const text = await generateVision(
    [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          {
            text: `This photo shows a handwritten exam answer by a Punjab Board Class ${profile.classLevel} student in ${subject?.name ?? subjectId}. Grade it exactly like a BISE board examiner marking a ${marksTotal}-mark question:
- Read the question if visible, otherwise infer it from the answer.
- Award marks the way board marking schemes do (points, definitions, diagrams, solved steps).
- strengths: 2-3 specific things done well.
- improvements: 2-4 specific, actionable fixes that would earn more marks (missing points, structure, headings, diagrams).
- examinerNote: one warm sentence, teacher-style, mixing English and Urdu naturally.
marksTotal must be ${marksTotal}. Use plain text only, no markdown symbols.`,
          },
        ],
      },
    ],
    { system: APP_CONTEXT, responseSchema: GRADE_SCHEMA, temperature: 0.4 },
  );
  try {
    return JSON.parse(text) as AnswerGrade;
  } catch {
    throw new GeminiError('Could not grade the answer. Take a clearer photo and retry.', 'parse');
  }
}

// ---------- Snap-to-study: notes photo -> flashcards ----------

export interface GeneratedCard {
  front: string;
  back: string;
}

const CARDS_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { front: { type: 'string' }, back: { type: 'string' } },
        required: ['front', 'back'],
      },
    },
  },
  required: ['topic', 'cards'],
};

export async function cardsFromImage(
  profile: StudentProfile,
  imageBase64: string,
): Promise<{ topic: string; cards: GeneratedCard[] }> {
  const text = await generateVision(
    [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          {
            text: `This is a photo of a Pakistani matric (Class ${profile.classLevel}) textbook page or handwritten class notes. Extract the content that matters for board exams and turn it into 6-12 flashcards.
- front: a short question or term (the kind boards ask as short questions/MCQs).
- back: the precise answer in 1-3 lines, exam-ready wording.
- Keep the language of the source material (English or Urdu).
- topic: 2-4 word label of what this page covers.
Plain text only, no markdown.`,
          },
        ],
      },
    ],
    { system: APP_CONTEXT, responseSchema: CARDS_SCHEMA, temperature: 0.5 },
  );
  try {
    const parsed = JSON.parse(text) as { topic: string; cards: GeneratedCard[] };
    if (!parsed.cards?.length) throw new Error('empty');
    return parsed;
  } catch {
    throw new GeminiError('Could not read that photo. Try better lighting.', 'parse');
  }
}

// ---------- Session tip (plan enrichment) ----------

export async function sessionTip(
  profile: StudentProfile,
  subjectName: string,
  chapterName: string,
  kind: string,
): Promise<string> {
  return generateText(
    [
      {
        role: 'user',
        parts: [
          {
            text: `Give one specific, practical study tip (2-3 sentences max) for a Punjab Board Class ${profile.classLevel} student about to ${kind} the chapter "${chapterName}" in ${subjectName}. Reference what the board actually asks from this chapter if you can. Friendly teacher tone, English with natural Urdu phrases. Plain text only.`,
          },
        ],
      },
    ],
    { system: APP_CONTEXT, temperature: 0.8, maxOutputTokens: 200 },
  );
}
