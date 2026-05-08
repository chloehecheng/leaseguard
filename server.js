// Load .env file automatically — must be first line
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Claude API helper ───────────────────────────────────────────────────────
async function callClaude({ system, user, maxTokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'sk-ant-api03-YOUR_KEY_HERE') {
    throw new Error('ANTHROPIC_API_KEY is not set in your .env file.');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages:   [{ role: 'user', content: user }],
    }),
  });

  const rawText = await res.text();

  if (!res.ok) {
    console.error('Anthropic error:', rawText.substring(0, 400));
    let msg = `Anthropic API error ${res.status}`;
    try { msg = JSON.parse(rawText)?.error?.message || msg; } catch (_) {}
    throw new Error(msg);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    throw new Error('Could not parse Anthropic API response.');
  }

  if (!Array.isArray(data.content)) {
    console.error('Unexpected response shape:', JSON.stringify(data).substring(0, 300));
    throw new Error('Unexpected response from Anthropic API.');
  }

  const text = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  if (!text) throw new Error('Empty response from Anthropic API.');
  console.log(`  ✓ Response received (${text.length} chars)`);
  return text;
}

// ── JSON parse helper ───────────────────────────────────────────────────────
function safeParseJSON(raw) {
  // Remove markdown fences if present
  let clean = raw.trim();
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch (_) {
    try { return JSON.parse(raw.trim()); } catch (e) {
      console.error('JSON parse failed, raw start:', raw.substring(0, 200));
      throw new Error('Model returned invalid JSON. Please try again.');
    }
  }
}

// ── POST /api/analyze-lease ─────────────────────────────────────────────────
app.post('/api/analyze-lease', async (req, res) => {
  const { leaseText } = req.body;
  if (!leaseText || typeof leaseText !== 'string' || leaseText.trim().length < 30) {
    return res.status(400).json({ error: 'leaseText is required (min 30 characters).' });
  }

  const truncated = leaseText.trim().substring(0, 6000);

  const system = `You are an expert legal analyst specializing in residential lease agreements for tenants.
Identify clauses that may disadvantage the tenant.
Respond with ONLY a valid JSON object — no markdown fences, no prose, no extra text.`;

  const user = `Analyze this lease and return ONLY valid JSON (no backticks, no markdown):

{
  "risk_score": <integer 0-100, higher = riskier for tenant>,
  "risk_level": "<high if >=70, medium if 40-69, low if <40>",
  "summary": "<2-3 plain-English sentences about main tenant concerns>",
  "risky_clauses": [
    {
      "id": "c1",
      "title": "<clause name>",
      "category": "<Rent/Payment | Security Deposit | Termination | Maintenance | Liability | Entry/Privacy | Renewal | Arbitration | Other>",
      "risk_level": "<high | medium | low>",
      "original_text": "<verbatim excerpt, max 100 words>",
      "explanation": "<2-3 sentences in plain English>",
      "why_risky": "<1-2 sentences on how this harms tenant>",
      "suggestion": "<1-2 sentences of specific advice>"
    }
  ],
  "clause_explanations": { "<category>": "<one sentence>" },
  "tenant_friendly_suggestions": ["<action>", "<action>", "<action>", "<action>", "<action>"],
  "questions_to_ask_landlord": ["<question>", "<question>", "<question>", "<question>"]
}

Find 5-9 clauses. Flag: sole discretion, non-refundable, automatic renewal, binding arbitration, waives rights, entry at any time, tenant liable for all damages.

LEASE:
${truncated}`;

  try {
    const raw    = await callClaude({ system, user, maxTokens: 2500 });
    const parsed = safeParseJSON(raw);
    const result = {
      risk_score:  Math.min(100, Math.max(0, Number(parsed.risk_score) || 50)),
      risk_level:  ['high','medium','low'].includes(parsed.risk_level) ? parsed.risk_level : 'medium',
      summary:     String(parsed.summary || ''),
      risky_clauses: Array.isArray(parsed.risky_clauses) ? parsed.risky_clauses : [],
      clause_explanations: parsed.clause_explanations || {},
      tenant_friendly_suggestions: Array.isArray(parsed.tenant_friendly_suggestions) ? parsed.tenant_friendly_suggestions : [],
      questions_to_ask_landlord:   Array.isArray(parsed.questions_to_ask_landlord)   ? parsed.questions_to_ask_landlord   : [],
    };
    console.log(`  ✓ Analysis done — score: ${result.risk_score}, clauses: ${result.risky_clauses.length}`);
    return res.json(result);
  } catch (err) {
    console.error('[analyze-lease]', err.message);
    return res.status(500).json({ error: err.message || 'Analysis failed. Please try again.' });
  }
});

// ── POST /api/ask-lease-question ────────────────────────────────────────────
app.post('/api/ask-lease-question', async (req, res) => {
  const { leaseText, userQuestion } = req.body;
  if (!leaseText   || typeof leaseText   !== 'string' || leaseText.trim().length   < 10) return res.status(400).json({ error: 'leaseText is required.'   });
  if (!userQuestion || typeof userQuestion !== 'string' || userQuestion.trim().length < 2) return res.status(400).json({ error: 'userQuestion is required.' });

  const system = `You are a helpful assistant answering questions about a specific residential lease.
Answer ONLY based on what is written in the lease text provided.
If the lease does not address the question, say so clearly.
Use plain English. Be direct and concise (2-4 sentences).
Do not provide legal advice.`;

  const user = `LEASE:
---
${leaseText.trim().substring(0, 6000)}
---

QUESTION: ${userQuestion.trim()}`;

  try {
    const answer = await callClaude({ system, user, maxTokens: 500 });
    return res.json({ answer: answer.trim() });
  } catch (err) {
    console.error('[ask-lease-question]', err.message);
    return res.status(500).json({ error: err.message || 'Could not answer. Please try again.' });
  }
});

// ── GET /api/health ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const keySet = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-api03-YOUR_KEY_HERE');
  res.json({ status: keySet ? 'ok' : 'missing_api_key', anthropic_key_set: keySet });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('\n  LeaseGuard server started');
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  API key: ${process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ MISSING'}\n`);
});
