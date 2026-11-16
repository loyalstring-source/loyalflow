// Reads a CV with Google's Gemini API and returns the fields LoyalHire needs.
// The CV (the PDF itself, or the text of a Word file) is sent to Google. That is a decision the COO took on 11 Nov 2026;
// it is off until an API key is saved under Hiring → Settings, and every call is recorded against the candidate.
// The key never leaves the server and is never written to a log.

export interface CvData {
  fullName: string; email: string; phone: string; location: string; currentEmployer: string; currentRole: string;
  experienceYears: number | null; skills: string[]; education: string[]; summary: string;
}
export const EMPTY_CV: CvData = { fullName: '', email: '', phone: '', location: '', currentEmployer: '', currentRole: '', experienceYears: null, skills: [], education: [], summary: '' };

export interface AiResult { ok: boolean; data?: CvData; error?: string; retryable?: boolean }
export interface CvInput { text?: string; file?: { mime: string; base64: string } }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const PROMPT = `You are reading one candidate's CV for a recruiter at an Indian software and RFID company.
Return only what the CV says. Never invent an employer, a date, a skill or a qualification. Leave a field empty if the CV does not state it.
- fullName: the candidate's name as written.
- email, phone: as written. Phone with country code if given.
- location: current city.
- currentEmployer, currentRole: the most recent job.
- experienceYears: total years of work experience as a number (one decimal at most). Use the CV's own statement if there is one; otherwise add up the dated jobs. null if it cannot be worked out.
- skills: up to 12 concrete skills, tools or domains, most relevant first.
- education: up to 3 lines, highest first, each "Degree, Institution, Year".
- summary: 60 to 90 words in plain English, third person, for a recruiter deciding whether to call. Say what the person has done, for how long, in which domain, and anything notable (gaps, frequent moves, notice period if stated). No praise words.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    fullName: { type: 'STRING' }, email: { type: 'STRING' }, phone: { type: 'STRING' }, location: { type: 'STRING' },
    currentEmployer: { type: 'STRING' }, currentRole: { type: 'STRING' }, experienceYears: { type: 'NUMBER', nullable: true },
    skills: { type: 'ARRAY', items: { type: 'STRING' } }, education: { type: 'ARRAY', items: { type: 'STRING' } }, summary: { type: 'STRING' }
  },
  required: ['fullName', 'summary']
};

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
/** Whatever comes back is treated as untrusted text: trimmed, length-limited and typed before it goes anywhere. */
export function cleanCvData(raw: unknown): CvData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const years = typeof o.experienceYears === 'number' && o.experienceYears >= 0 && o.experienceYears < 60 ? Math.round(o.experienceYears * 10) / 10 : null;
  return {
    fullName: str(o.fullName, 120), email: str(o.email, 160).toLowerCase(), phone: str(o.phone, 30), location: str(o.location, 80),
    currentEmployer: str(o.currentEmployer, 120), currentRole: str(o.currentRole, 120), experienceYears: years,
    skills: list(o.skills, 12, 60), education: list(o.education, 3, 160), summary: str(o.summary, 900)
  };
}

export function createGemini(cfg: { apiKey: string; model?: string }, fetchImpl: FetchLike = fetch as unknown as FetchLike): { configured: boolean; model: string; extract(input: CvInput): Promise<AiResult> } {
  const model = (cfg.model || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
  const configured = !!cfg.apiKey;
  return {
    configured, model,
    async extract(input: CvInput): Promise<AiResult> {
      if (!configured) return { ok: false, error: 'No Gemini API key has been saved.' };
      const parts: unknown[] = [];
      if (input.file) parts.push({ inline_data: { mime_type: input.file.mime, data: input.file.base64 } });
      if (input.text) parts.push({ text: `CV text:\n${input.text.slice(0, 60_000)}` });
      if (!parts.length) return { ok: false, error: 'Nothing to read.' };
      parts.push({ text: PROMPT });
      const body = JSON.stringify({ contents: [{ parts }], generationConfig: { response_mime_type: 'application/json', response_schema: SCHEMA, temperature: 0.1 } });
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body, signal: AbortSignal.timeout(60_000) });
      } catch (e) { return { ok: false, retryable: true, error: `Could not reach Gemini (${(e as Error).name}). Check the internet connection.` }; }
      if (res.status !== 200) {
        let msg = ''; try { const j = await res.json() as { error?: { message?: string } }; msg = j.error?.message || ''; } catch { /* no body */ }
        const hint = res.status === 429 ? 'The free limit for this minute or day has been reached.' : res.status === 400 && /API key/i.test(msg) ? 'The API key was not accepted.' : res.status === 403 ? 'The API key is not allowed to use this model.' : res.status === 404 ? `The model "${model}" was not found. Change the model name in Hiring → Settings.` : '';
        return { ok: false, retryable: res.status === 429 || res.status >= 500, error: `Gemini answered ${res.status}. ${hint || msg.slice(0, 200)}`.trim() };
      }
      try {
        const j = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        if (!text) return { ok: false, error: 'Gemini returned nothing for this file.' };
        return { ok: true, data: cleanCvData(JSON.parse(text)) };
      } catch { return { ok: false, error: 'Gemini returned something that could not be read.' }; }
    }
  };
}
