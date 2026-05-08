# LeaseGuard

AI-powered residential lease analyzer. Built with Node.js + Express on the backend, Claude (claude-sonnet-4) for analysis, and a single-page HTML/CSS/JS frontend.

## Project Structure

```
leaseguard/
├── server.js          ← Express API server
├── package.json
├── .env.example       ← Copy to .env and fill in your API key
├── .gitignore
└── public/
    └── index.html     ← Frontend (served statically by the server)
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set your Anthropic API key

```bash
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Never commit `.env` or expose your API key in client-side code.**

### 3. Load environment variables

Node does not read `.env` automatically. Either:

- Use a package: `npm install dotenv` then add `require('dotenv').config()` at the top of `server.js`
- Or export directly before running: `export $(cat .env | xargs) && npm start`
- Or use a platform like Railway, Render, or Vercel that injects env vars natively

### 4. Run the server

```bash
# Production
npm start

# Development (auto-restarts on file changes, Node 18+)
npm run dev
```

The app is available at **http://localhost:3000**

---

## API Endpoints

### `POST /api/analyze-lease`

Full contract risk analysis.

**Request body:**
```json
{ "leaseText": "RESIDENTIAL LEASE AGREEMENT..." }
```

**Response:**
```json
{
  "risk_score": 74,
  "risk_level": "high",
  "summary": "This lease contains...",
  "risky_clauses": [
    {
      "id": "c1",
      "title": "Binding Arbitration",
      "category": "Arbitration",
      "risk_level": "high",
      "original_text": "...",
      "explanation": "...",
      "why_risky": "...",
      "suggestion": "..."
    }
  ],
  "clause_explanations": { "Arbitration": "..." },
  "tenant_friendly_suggestions": ["...", "..."],
  "questions_to_ask_landlord": ["...", "..."]
}
```

---

### `POST /api/ask-lease-question`

Grounded Q&A — answers are based only on the provided lease text.

**Request body:**
```json
{
  "leaseText": "RESIDENTIAL LEASE AGREEMENT...",
  "userQuestion": "Can my landlord enter without notice?"
}
```

**Response:**
```json
{ "answer": "According to Section 7..." }
```

---

### `GET /api/health`

Returns server status and whether the API key is configured.

---

## Security Notes

- `ANTHROPIC_API_KEY` is stored **only** in server-side environment variables
- The key is **never** sent to or accessible from the browser
- All Anthropic API calls happen **server-side** only
- Contract text is processed in-memory and never written to disk (in this prototype)
- For production, add rate limiting (e.g. `express-rate-limit`) and authentication before the API endpoints
