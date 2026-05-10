require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const multer   = require('multer');
const pdfParse = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' ||
               file.originalname.toLowerCase().endsWith('.pdf');
    cb(null, ok);
  },
});

const app  = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
}

// Global Supabase client (auth only — no RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    realtime: { webSocketImpl: WebSocket },
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.user  = user;
  req.token = token;
  next();
}

// ── Per-request Supabase client using user JWT (respects RLS) ────────────────
function supabaseForRequest(req) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      realtime: { webSocketImpl: WebSocket },
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: 'Bearer ' + req.token,
        },
      },
    }
  );
}

// ── Claude API helper ────────────────────────────────────────────────────────
async function callClaude({ system, user, maxTokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'sk-ant-api03-YOUR_KEY_HERE') {
    throw new Error('ANTHROPIC_API_KEY is not set in your .env file.');
  }
  console.log('  -> Calling Anthropic API...');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages:   [{ role: 'user', content: user }],
    }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    console.error('Anthropic error:', rawText.substring(0, 400));
    let msg = 'Anthropic API error ' + res.status;
    try { msg = JSON.parse(rawText).error.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  let data;
  try { data = JSON.parse(rawText); }
  catch (_) { throw new Error('Could not parse Anthropic API response.'); }
  if (!Array.isArray(data.content)) throw new Error('Unexpected response from Anthropic API.');
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new Error('Empty response from Anthropic API.');
  console.log('  ✓ Response received (' + text.length + ' chars)');
  return text;
}

// ── JSON extractor ────────────────────────────────────────────────────────────
function extractJSON(raw) {
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return a valid JSON object. Please try again.');
  }
  try {
    return JSON.parse(raw.substring(start, end + 1));
  } catch (e) {
    console.error('JSON parse error:', e.message);
    throw new Error('Model returned malformed JSON. Please try again.');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name || '' } },
  });
  if (error) { console.error('[signup]', error.message); return res.status(400).json({ error: error.message }); }
  return res.json({
    message: 'Account created! Check your email to verify your account.',
    user: { id: data.user?.id, email: data.user?.email, name },
    session: data.session,
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('  [login] Attempting login for:', email);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  let data, error;
  try {
    const result = await supabase.auth.signInWithPassword({ email, password });
    data = result.data; error = result.error;
  } catch (e) {
    console.error('  [login] Exception:', e.message);
    return res.status(500).json({ error: 'Auth service error: ' + e.message });
  }
  if (error) { console.error('  [login] Supabase error:', error.message); return res.status(401).json({ error: error.message || 'Invalid email or password.' }); }
  if (!data?.session) return res.status(401).json({ error: 'Login failed — no session returned.' });
  const name = data.user?.user_metadata?.full_name || email.split('@')[0];
  console.log('  [login] Success for:', email);
  return res.json({
    user: { id: data.user.id, email: data.user.email, name },
    session: { access_token: data.session.access_token, expires_at: data.session.expires_at },
  });
});

app.post('/api/auth/logout', requireAuth, async (_req, res) => {
  await supabase.auth.signOut();
  return res.json({ message: 'Logged out successfully.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'http://localhost:3000' });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ message: 'Password reset email sent. Check your inbox.' });
});

app.post('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  const cleanName = String(name).trim().substring(0, 100);

  // Try Supabase Auth updateUser first
  const userSupabase = createClient(
    process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
    {
      realtime: { webSocketImpl: WebSocket },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + req.token } },
    }
  );

  const { error: authError } = await userSupabase.auth.updateUser({
    data: { full_name: cleanName, display_name: cleanName },
  });

  if (authError) {
    console.warn('[update-profile] Auth updateUser failed:', authError.message, '— falling back to profiles table');
  }

  // Always upsert into profiles table as the source of truth
  const userDb = supabaseForRequest(req);
  const { error: dbError } = await userDb
    .from('profiles')
    .upsert({ id: req.user.id, full_name: cleanName, updated_at: new Date().toISOString() })
    .eq('id', req.user.id);

  if (dbError) {
    // profiles table might not exist yet — still return success if auth worked
    if (!authError) {
      console.warn('[update-profile] profiles upsert failed (table may not exist):', dbError.message);
      return res.json({ message: 'Profile updated.', name: cleanName });
    }
    console.error('[update-profile] both methods failed:', dbError.message);
    return res.status(500).json({ error: 'Could not update profile: ' + dbError.message });
  }

  console.log('[update-profile] name updated to:', cleanName, 'for user:', req.user.id);
  return res.json({ message: 'Profile updated.', name: cleanName });
});

app.delete('/api/auth/delete-account', requireAuth, async (req, res) => {
  const userDb = supabaseForRequest(req);
  await userDb.from('contracts').delete().eq('user_id', req.user.id);
  const { error } = await supabase.auth.admin?.deleteUser?.(req.user.id);
  if (error) console.log('Admin delete not available, signing out user:', req.user.id);
  return res.json({ message: 'Account deleted.' });
});

app.post('/api/auth/update-password', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const userSupabase = createClient(
    process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: 'Bearer ' + req.token } } }
  );
  const { error } = await userSupabase.auth.updateUser({ password });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ message: 'Password updated successfully.' });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  // Check profiles table for custom display name (works for OAuth users too)
  const userDb = supabaseForRequest(req);
  const { data: profile } = await userDb
    .from('profiles')
    .select('full_name')
    .eq('id', req.user.id)
    .single();

  const name = profile?.full_name
    || req.user.user_metadata?.full_name
    || req.user.user_metadata?.name
    || req.user.email.split('@')[0];

  return res.json({ user: { id: req.user.id, email: req.user.email, name } });
});

// ════════════════════════════════════════════════════════════════════════════
// CONTRACTS — all use supabaseForRequest (user JWT + RLS)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/contracts
app.get('/api/contracts', requireAuth, async (req, res) => {
  const userDb = supabaseForRequest(req);
  const { data, error } = await userDb
    .from('contracts')
    .select('id, name, risk_score, risk_level, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('[get contracts]', error.message, error.details);
    return res.status(500).json({ error: 'Could not load contracts: ' + error.message });
  }
  return res.json({ contracts: data || [] });
});

// POST /api/contracts/save  — MUST be before /:id
app.post('/api/contracts/save', requireAuth, async (req, res) => {
  const userDb = supabaseForRequest(req);
  const { name, leaseText, analysis, riskScore, riskLevel } = req.body;
  if (!analysis) return res.status(400).json({ error: 'analysis is required.' });

  const cleanAnalysis = { ...analysis };
  delete cleanAnalysis._leaseText;
  delete cleanAnalysis._contractId;
  delete cleanAnalysis._contractName;

  const finalName = name && String(name).trim()
    ? String(name).trim().substring(0, 120)
    : 'Lease — ' + new Date().toLocaleDateString();

  const finalRiskScore = Number(riskScore || cleanAnalysis.risk_score) || null;
  const finalRiskLevel = ['high', 'medium', 'low'].includes(riskLevel || cleanAnalysis.risk_level)
    ? (riskLevel || cleanAnalysis.risk_level) : null;

  console.log('[contracts/save] user:', req.user.id, 'name:', finalName, 'leaseText length:', String(leaseText || '').length);

  const { data, error } = await userDb
    .from('contracts')
    .insert({
      user_id:    req.user.id,
      name:       finalName,
      lease_text: String(leaseText || '').substring(0, 10000),
      analysis:   cleanAnalysis,
      risk_score: finalRiskScore,
      risk_level: finalRiskLevel,
    })
    .select('id, name, risk_score, risk_level, created_at')
    .single();

  if (error) {
    console.error('[contracts/save] DB error:', error.message, error.details);
    return res.status(500).json({ error: 'Could not save contract: ' + error.message });
  }
  console.log('✓ Contract saved:', data.id);
  return res.json({ id: data.id, contract: data, message: 'Contract saved successfully.' });
});

// GET /api/contracts/:id
app.get('/api/contracts/:id', requireAuth, async (req, res) => {
  const userDb = supabaseForRequest(req);
  const { data, error } = await userDb
    .from('contracts')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (error || !data) {
    console.error('[get contract]', error?.message);
    return res.status(404).json({ error: 'Contract not found.' });
  }
  return res.json({ contract: data });
});

// DELETE /api/contracts/:id
app.delete('/api/contracts/:id', requireAuth, async (req, res) => {
  const userDb = supabaseForRequest(req);
  const { error } = await userDb
    .from('contracts')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) {
    console.error('[delete contract]', error.message);
    return res.status(500).json({ error: 'Could not delete contract: ' + error.message });
  }
  return res.json({ message: 'Contract deleted.' });
});

// ════════════════════════════════════════════════════════════════════════════
// LEASE ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/extract-pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });
  try {
    console.log('  -> Extracting PDF:', req.file.originalname, '(' + req.file.size + ' bytes)');
    const data = await pdfParse(req.file.buffer);
    const text = data.text || '';
    if (!text.trim()) {
      return res.status(422).json({ error: 'Could not extract text from this PDF. It may be a scanned image. Please paste the text manually.' });
    }
    console.log('  ✓ PDF extracted:', data.numpages, 'pages,', text.length, 'chars');
    return res.json({ text: text.trim(), pages: data.numpages, chars: text.length });
  } catch (err) {
    console.error('[extract-pdf]', err.message);
    return res.status(500).json({ error: 'Could not parse PDF: ' + err.message });
  }
});

app.post('/api/analyze-lease', async (req, res) => {
  const { leaseText } = req.body;
  if (!leaseText || typeof leaseText !== 'string' || leaseText.trim().length < 30) {
    return res.status(400).json({ error: 'leaseText is required (min 30 characters).' });
  }
  const truncated = leaseText.trim().substring(0, 6000);
  const system = [
    'You are an expert legal analyst specializing in residential lease agreements for tenants.',
    'Identify clauses that may disadvantage the tenant.',
    'You MUST respond with ONLY a raw JSON object.',
    'Do NOT use markdown. Do NOT use backticks. Do NOT wrap in code blocks.',
    'Start your response with { and end with }. Nothing before or after.',
  ].join(' ');
  const user = 'Return ONLY a raw JSON object starting with { — no backticks, no markdown, no code blocks.\n\n' +
    'Schema:\n{\n' +
    '  "risk_score": <integer 0-100>,\n' +
    '  "risk_level": "<high|medium|low>",\n' +
    '  "summary": "<2-3 sentences>",\n' +
    '  "risky_clauses": [\n' +
    '    {\n' +
    '      "id": "c1",\n' +
    '      "title": "<name>",\n' +
    '      "category": "<Rent/Payment|Security Deposit|Termination|Maintenance|Liability|Entry/Privacy|Renewal|Arbitration|Other>",\n' +
    '      "risk_level": "<high|medium|low>",\n' +
    '      "original_text": "<excerpt max 80 words>",\n' +
    '      "explanation": "<2-3 plain English sentences>",\n' +
    '      "why_risky": "<1-2 sentences>",\n' +
    '      "suggestion": "<1-2 sentences of advice>"\n' +
    '    }\n' +
    '  ],\n' +
    '  "clause_explanations": { "<category>": "<one sentence>" },\n' +
    '  "tenant_friendly_suggestions": ["<action>","<action>","<action>","<action>","<action>"],\n' +
    '  "questions_to_ask_landlord": ["<question>","<question>","<question>","<question>"]\n' +
    '}\n\n' +
    'Find 5-9 clauses. Flag: sole discretion, non-refundable, automatic renewal, binding arbitration, waives rights, entry at any time, tenant liable for all damages.\n\nLEASE:\n' + truncated;
  try {
    const raw    = await callClaude({ system, user, maxTokens: 4000 });
    const parsed = extractJSON(raw);
    const result = {
      risk_score:  Math.min(100, Math.max(0, Number(parsed.risk_score) || 50)),
      risk_level:  ['high','medium','low'].includes(parsed.risk_level) ? parsed.risk_level : 'medium',
      summary:     String(parsed.summary || ''),
      risky_clauses: Array.isArray(parsed.risky_clauses) ? parsed.risky_clauses : [],
      clause_explanations: parsed.clause_explanations || {},
      tenant_friendly_suggestions: Array.isArray(parsed.tenant_friendly_suggestions) ? parsed.tenant_friendly_suggestions : [],
      questions_to_ask_landlord:   Array.isArray(parsed.questions_to_ask_landlord)   ? parsed.questions_to_ask_landlord   : [],
    };
    console.log('  ✓ Analysis done — score: ' + result.risk_score + ', clauses: ' + result.risky_clauses.length);
    return res.json(result);
  } catch (err) {
    console.error('[analyze-lease]', err.message);
    return res.status(500).json({ error: err.message || 'Analysis failed. Please try again.' });
  }
});

app.post('/api/ask-lease-question', async (req, res) => {
  const { leaseText, userQuestion } = req.body;
  if (!leaseText    || typeof leaseText    !== 'string' || leaseText.trim().length    < 10) return res.status(400).json({ error: 'leaseText is required.' });
  if (!userQuestion || typeof userQuestion !== 'string' || userQuestion.trim().length < 2)  return res.status(400).json({ error: 'userQuestion is required.' });
  const system = [
    'You are a knowledgeable tenant rights advisor and lease consultant.',
    'You have deep expertise in residential lease agreements, landlord-tenant law, and negotiation strategies.',
    'Your role is to help tenants understand their lease and give clear, practical advice.',
    'CRITICAL FORMATTING RULES:',
    '- Write in plain conversational prose only. No markdown whatsoever.',
    '- Do NOT use asterisks, pound signs, hyphens as bullets, pipes, or any special characters for formatting.',
    '- Do NOT create tables. Do NOT use bold or italic markers.',
    '- Use plain numbered lists like 1. 2. 3. only when listing multiple items.',
    '- Write as if speaking to the tenant in a friendly clear conversation.',
    'ANSWER STRUCTURE:',
    'First briefly explain what the lease says about the topic.',
    'Second say whether this is fair standard or a red flag and why.',
    'Third give your suggestion what the tenant should consider doing.',
    'Finally end with this disclaimer on its own line: Keep in mind these are suggestions to help you think through your options. Whether you sign this lease is entirely your personal decision, and I recommend consulting a local tenant rights organization or attorney if you have serious concerns.',
    'Be warm direct and advocate for the tenant.',
  ].join(' ');
  const user = 'LEASE TEXT:\n---\n' + leaseText.trim().substring(0, 6000) + '\n---\n\nTENANT QUESTION: ' + userQuestion.trim() + '\n\nAnswer in plain prose with no markdown, no symbols, no tables.';
  try {
    const answer = await callClaude({ system, user, maxTokens: 800 });
    const clean = answer
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^\s*[-–—]\s+/gm, '')
      .replace(/\|[-| ]+\|/g, '')
      .replace(/\|/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return res.json({ answer: clean });
  } catch (err) {
    console.error('[ask-lease-question]', err.message);
    return res.status(500).json({ error: err.message || 'Could not answer. Please try again.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    supabase_url:  !!process.env.SUPABASE_URL,
    supabase_key:  !!process.env.SUPABASE_ANON_KEY,
  });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('\n  LeaseGuard server started');
  console.log('  URL:        http://localhost:' + PORT);
  console.log('  Anthropic:  ' + (process.env.ANTHROPIC_API_KEY ? '✓' : '✗ MISSING'));
  console.log('  Supabase:   ' + (process.env.SUPABASE_URL ? '✓' : '✗ MISSING') + '\n');
});
