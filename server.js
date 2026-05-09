require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function getAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key || key === 'sk-ant-api03-YOUR_KEY_HERE') {
    throw new Error('ANTHROPIC_API_KEY is not set in your .env file.');
  }

  return key;
}

function getLeaseTextFromBody(body) {
  return (
    body.leaseText ||
    body.contractText ||
    body.text ||
    body.content ||
    body.lease ||
    ''
  );
}

function getQuestionFromBody(body) {
  return (
    body.userQuestion ||
    body.question ||
    body.prompt ||
    ''
  );
}

function normalizeRiskLevel(level, score = 50) {
  const cleaned = String(level || '').toLowerCase().trim();

  if (['high', 'medium', 'low'].includes(cleaned)) {
    return cleaned;
  }

  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function normalizeAnalysisResult(parsed) {
  const riskScore = Math.min(
    100,
    Math.max(0, Number(parsed?.risk_score) || 50)
  );

  return {
    risk_score: riskScore,
    risk_level: normalizeRiskLevel(parsed?.risk_level, riskScore),
    summary: String(parsed?.summary || ''),

    risky_clauses: Array.isArray(parsed?.risky_clauses)
      ? parsed.risky_clauses
      : [],

    clause_explanations:
      parsed?.clause_explanations &&
      typeof parsed.clause_explanations === 'object'
        ? parsed.clause_explanations
        : {},

    tenant_friendly_suggestions: Array.isArray(parsed?.tenant_friendly_suggestions)
      ? parsed.tenant_friendly_suggestions
      : [],

    questions_to_ask_landlord: Array.isArray(parsed?.questions_to_ask_landlord)
      ? parsed.questions_to_ask_landlord
      : [],

    red_flags: Array.isArray(parsed?.red_flags)
      ? parsed.red_flags
      : [],

    negotiation_tips: Array.isArray(parsed?.negotiation_tips)
      ? parsed.negotiation_tips
      : [],

    missing_or_unclear_terms: Array.isArray(parsed?.missing_or_unclear_terms)
      ? parsed.missing_or_unclear_terms
      : [],

    tenant_rights_notes: Array.isArray(parsed?.tenant_rights_notes)
      ? parsed.tenant_rights_notes
      : [],
  };
}

// Fallback only. Normally analyze uses Claude tool_use instead of text JSON.
function safeParseJSON(raw) {
  let cleaned = String(raw || '').trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    console.error('No JSON found:', cleaned.substring(0, 500));
    throw new Error('No JSON object found in model response.');
  }

  const jsonText = cleaned.substring(start, end + 1);

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    console.error('JSON parse failed. First 1000 chars:', jsonText.substring(0, 1000));
    console.error('Parse error:', e.message);
    throw new Error('Model returned invalid JSON. Please try again.');
  }
}

// ─────────────────────────────────────────────────────────────
// Claude text helper for chat
// ─────────────────────────────────────────────────────────────

async function callClaudeText({ system, user, maxTokens = 1000 }) {
  const key = getAnthropicKey();

  console.log('  -> Calling Anthropic API...');

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  const rawText = await apiRes.text();

  if (!apiRes.ok) {
    console.error('Anthropic error:', rawText.substring(0, 1000));

    let msg = `Anthropic API error ${apiRes.status}`;
    try {
      msg = JSON.parse(rawText)?.error?.message || msg;
    } catch (_) {}

    throw new Error(msg);
  }

  let data;

  try {
    data = JSON.parse(rawText);
  } catch (_) {
    throw new Error('Could not parse Anthropic API response.');
  }

  if (!Array.isArray(data.content)) {
    console.error('Unexpected response shape:', JSON.stringify(data).substring(0, 1000));
    throw new Error('Unexpected response from Anthropic API.');
  }

  const text = data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text) {
    throw new Error('Empty response from Anthropic API.');
  }

  console.log(`  ✓ Response received (${text.length} chars)`);
  return text;
}

// ─────────────────────────────────────────────────────────────
// Claude structured helper for analyze
// This avoids malformed JSON because Claude returns tool input object.
// ─────────────────────────────────────────────────────────────

async function callClaudeLeaseAnalysis({ leaseText, maxTokens = 5000 }) {
  const key = getAnthropicKey();

  const system = `You are a lease risk analysis engine for residential leases.

Your job:
- Analyze the lease from the tenant's perspective.
- Identify clauses that may disadvantage the tenant.
- Focus on practical tenant risk.
- Do not provide formal legal advice.
- Return the result by calling the analyze_lease_result tool.
- Do not write markdown.
- Do not write text outside the tool call.`;

  const user = `Analyze this residential lease from the tenant's perspective.

Find 4-8 risky clauses if possible.

Flag issues such as:
- non-refundable fees
- automatic renewal
- binding arbitration
- waiver of rights
- landlord entry at any time
- tenant liable for all damages
- landlord sole discretion
- unclear security deposit terms
- excessive late fees
- maintenance obligations shifted to tenant
- early termination penalties
- missing repair responsibilities
- unclear sublease rules
- unclear guest rules
- unclear notice requirements

LEASE TEXT:
---
${leaseText.trim().substring(0, 10000)}
---`;

  const toolSchema = {
    name: 'analyze_lease_result',
    description: 'Return a structured tenant-focused lease risk analysis.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        risk_score: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Higher means riskier for the tenant.',
        },
        risk_level: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
        },
        summary: {
          type: 'string',
          description: '2-3 plain-English sentences summarizing the main tenant concerns.',
        },
        risky_clauses: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: {
                type: 'string',
              },
              title: {
                type: 'string',
              },
              category: {
                type: 'string',
                enum: [
                  'Rent/Payment',
                  'Security Deposit',
                  'Termination',
                  'Maintenance',
                  'Liability',
                  'Entry/Privacy',
                  'Renewal',
                  'Arbitration',
                  'Other',
                ],
              },
              risk_level: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
              },
              original_text: {
                type: 'string',
                description: 'Short verbatim excerpt from the lease. Keep under 80 words.',
              },
              explanation: {
                type: 'string',
                description: '1-2 plain-English sentences explaining the clause.',
              },
              why_risky: {
                type: 'string',
                description: '1 sentence explaining how this may harm the tenant.',
              },
              suggestion: {
                type: 'string',
                description: '1 sentence of specific tenant-friendly advice.',
              },
            },
            required: [
              'id',
              'title',
              'category',
              'risk_level',
              'original_text',
              'explanation',
              'why_risky',
              'suggestion',
            ],
          },
        },
        clause_explanations: {
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
          description: 'Category-to-explanation object.',
        },
        tenant_friendly_suggestions: {
          type: 'array',
          minItems: 0,
          maxItems: 6,
          items: {
            type: 'string',
          },
        },
        questions_to_ask_landlord: {
          type: 'array',
          minItems: 0,
          maxItems: 6,
          items: {
            type: 'string',
          },
        },
        red_flags: {
          type: 'array',
          minItems: 0,
          maxItems: 6,
          items: {
            type: 'string',
          },
        },
        negotiation_tips: {
          type: 'array',
          minItems: 0,
          maxItems: 6,
          items: {
            type: 'string',
          },
        },
        missing_or_unclear_terms: {
          type: 'array',
          minItems: 0,
          maxItems: 6,
          items: {
            type: 'string',
          },
        },
        tenant_rights_notes: {
          type: 'array',
          minItems: 0,
          maxItems: 6,
          items: {
            type: 'string',
          },
        },
      },
      required: [
        'risk_score',
        'risk_level',
        'summary',
        'risky_clauses',
        'clause_explanations',
        'tenant_friendly_suggestions',
        'questions_to_ask_landlord',
        'red_flags',
        'negotiation_tips',
        'missing_or_unclear_terms',
        'tenant_rights_notes',
      ],
    },
  };

  console.log('  -> Calling Anthropic API with structured tool output...');

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [toolSchema],
      tool_choice: {
        type: 'tool',
        name: 'analyze_lease_result',
      },
    }),
  });

  const rawText = await apiRes.text();

  if (!apiRes.ok) {
    console.error('Anthropic error:', rawText.substring(0, 1000));

    let msg = `Anthropic API error ${apiRes.status}`;
    try {
      msg = JSON.parse(rawText)?.error?.message || msg;
    } catch (_) {}

    throw new Error(msg);
  }

  let data;

  try {
    data = JSON.parse(rawText);
  } catch (_) {
    console.error('Could not parse Anthropic API response:', rawText.substring(0, 1000));
    throw new Error('Could not parse Anthropic API response.');
  }

  if (!Array.isArray(data.content)) {
    console.error('Unexpected response shape:', JSON.stringify(data).substring(0, 1000));
    throw new Error('Unexpected response from Anthropic API.');
  }

  const toolUseBlock = data.content.find(
    (block) => block.type === 'tool_use' && block.name === 'analyze_lease_result'
  );

  if (toolUseBlock && toolUseBlock.input) {
    console.log('  ✓ Structured analysis received via tool_use');
    return toolUseBlock.input;
  }

  // Fallback: only if model returns text instead of tool_use
  const text = data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (text) {
    console.log('  ⚠ No tool_use found. Trying fallback JSON parse...');
    return safeParseJSON(text);
  }

  console.error('No usable content:', JSON.stringify(data).substring(0, 1000));
  throw new Error('Model did not return a usable analysis.');
}

// ─────────────────────────────────────────────────────────────
// POST /api/analyze-lease
// ─────────────────────────────────────────────────────────────

app.post('/api/analyze-lease', async (req, res) => {
  const leaseText = getLeaseTextFromBody(req.body);

  if (!leaseText || typeof leaseText !== 'string' || leaseText.trim().length < 30) {
    return res.status(400).json({
      error: 'leaseText is required and must be at least 30 characters.',
    });
  }

  try {
    const parsed = await callClaudeLeaseAnalysis({
      leaseText,
      maxTokens: 5000,
    });

    const result = normalizeAnalysisResult(parsed);

    console.log(
      `  ✓ Analysis done — score: ${result.risk_score}, clauses: ${result.risky_clauses.length}`
    );

    return res.json(result);
  } catch (err) {
    console.error('[analyze-lease]', err.message);

    return res.status(500).json({
      error: err.message || 'Analysis failed. Please try again.',
    });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/ask-lease-question
// Keeps your newer advisor-style feature.
// ─────────────────────────────────────────────────────────────

app.post('/api/ask-lease-question', async (req, res) => {
  const leaseText = getLeaseTextFromBody(req.body);
  const userQuestion = getQuestionFromBody(req.body);

  if (!leaseText || typeof leaseText !== 'string' || leaseText.trim().length < 10) {
    return res.status(400).json({
      error: 'leaseText is required.',
    });
  }

  if (!userQuestion || typeof userQuestion !== 'string' || userQuestion.trim().length < 2) {
    return res.status(400).json({
      error: 'userQuestion is required.',
    });
  }

  const system = [
    'You are a knowledgeable tenant rights advisor and lease consultant.',
    'You have deep expertise in residential lease agreements, landlord-tenant law, and negotiation strategies.',
    'Your role is to help tenants understand their lease and give clear, practical advice.',
    '',
    'CRITICAL FORMATTING RULES — you must follow these exactly:',
    '- Write in plain conversational prose only. No markdown whatsoever.',
    '- Do NOT use asterisks, pound signs, hyphens as bullets, pipes, or any special characters for formatting.',
    '- Do NOT create tables. Do NOT use bold or italic markers.',
    '- Use plain numbered lists like "1." "2." "3." only when listing multiple items.',
    '- Write as if you are speaking to the tenant in a friendly, clear conversation.',
    '- Keep sentences short and easy to read.',
    '',
    'ANSWER STRUCTURE — always follow this order in plain prose:',
    'First, briefly explain what the lease says about the topic.',
    'Second, say whether this is fair, standard, or a red flag and why in simple terms.',
    'Third, give your suggestion — what the tenant should consider doing.',
    'Finally, always end with this exact disclaimer on its own line: "Keep in mind these are suggestions to help you think through your options. Whether you sign this lease is entirely your personal decision, and I recommend consulting a local tenant rights organization or attorney if you have serious concerns."',
    '',
    'Be warm, direct, and advocate for the tenant. Do not over-hedge or use legal jargon.',
  ].join('\n');

  const user =
    'LEASE TEXT:\n---\n' +
    leaseText.trim().substring(0, 10000) +
    '\n---\n\nTENANT QUESTION: ' +
    userQuestion.trim() +
    '\n\nAnswer in plain prose with no markdown, no symbols, no tables. Be clear and conversational.';

  try {
    const answer = await callClaudeText({
      system,
      user,
      maxTokens: 900,
    });

    // Strip markdown if any slips through
    const clean = answer
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^\s*[-–—]\s+/gm, '')
      .replace(/\|[-| ]+\|/g, '')
      .replace(/\|/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return res.json({
      answer: clean,
    });
  } catch (err) {
    console.error('[ask-lease-question]', err.message);

    return res.status(500).json({
      error: err.message || 'Could not answer. Please try again.',
    });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  const keySet = !!(
    process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_API_KEY !== 'sk-ant-api03-YOUR_KEY_HERE'
  );

  res.json({
    status: keySet ? 'ok' : 'missing_api_key',
    anthropic_key_set: keySet,
  });
});

// ─────────────────────────────────────────────────────────────
// Frontend fallback
// ─────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n  LeaseGuard server started');
  console.log('  URL:     http://localhost:' + PORT);
  console.log('  API key: ' + (process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING') + '\n');
});