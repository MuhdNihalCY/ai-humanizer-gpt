// ============================================================
//  server.js  —  AI Humanizer GPT Action API
//  Deploy to: Railway / Render / Fly.io (all free tier)
// ============================================================

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { detectAI, humanize } = require('./engine');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────

app.use(cors({ origin: '*' }));   // Required for ChatGPT to call your API
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting — free tier protection
const limiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  max: 30,                   // 30 requests/min per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ─── ROUTES ───────────────────────────────────────────────────

// GPT Plugin manifest (required for old plugin system)
app.get('/.well-known/ai-plugin.json', (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const base = `${protocol}://${host}`;

  res.json({
    schema_version: 'v1',
    name_for_human: 'AI Humanizer Pro',
    name_for_model: 'ai_humanizer',
    description_for_human: 'Detect AI-generated text and rewrite it to sound natural and human. Free to use.',
    description_for_model: `Use this plugin to:
1. Detect whether text was written by an AI (returns a probability score 0-100 and signals).
2. Humanize AI text by rewriting it to sound more natural, conversational, and human.
3. Do both in one call: detect first, then humanize if AI probability > 50.
Always call detect before humanize when the user isn't sure if text is AI-generated.`,
    auth: { type: 'none' },
    api: {
      type: 'openapi',
      url: `${base}/openapi.yaml`,
    },
    logo_url: `${base}/logo.png`,
    contact_email: 'support@ai-humanizer.example.com',
    legal_info_url: `${base}/legal`,
  });
});

// OpenAPI spec (required for GPT Actions)
app.get('/openapi.yaml', (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const base = `${protocol}://${host}`;

  res.type('text/yaml').send(`
openapi: 3.1.0
info:
  title: AI Humanizer Pro
  description: Detect AI-generated text and rewrite it to sound natural and human.
  version: 1.0.0
servers:
  - url: ${base}
paths:
  /api/detect:
    post:
      operationId: detectAI
      summary: Detect whether text was written by AI
      description: >
        Analyzes text and returns a probability score (0-100) indicating how likely 
        it is to be AI-generated, plus specific signals detected.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [text]
              properties:
                text:
                  type: string
                  description: The text to analyze (min 30 chars)
                  maxLength: 10000
      responses:
        '200':
          description: Detection result
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DetectResult'
        '400':
          description: Invalid input

  /api/humanize:
    post:
      operationId: humanizeText
      summary: Rewrite AI-generated text to sound human
      description: >
        Takes AI-generated text and rewrites it to be more natural, conversational, 
        and human-sounding. Removes AI clichés, adds contractions, varies sentence 
        structure, and strips AI filler phrases.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [text]
              properties:
                text:
                  type: string
                  description: The AI-generated text to humanize
                  maxLength: 10000
                level:
                  type: string
                  enum: [light, medium, aggressive]
                  default: medium
                  description: >
                    light = minimal changes (synonyms only).
                    medium = synonyms + contractions + filler removal (default).
                    aggressive = full rewrite with sentence restructuring.
      responses:
        '200':
          description: Humanized text result
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HumanizeResult'
        '400':
          description: Invalid input

  /api/detect-and-humanize:
    post:
      operationId: detectAndHumanize
      summary: Detect AI text AND humanize it in one call
      description: >
        First detects if text is AI-generated. If the probability is above the 
        threshold (default 40), it also returns a humanized version. Best for 
        cases where you're unsure if text needs humanizing.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [text]
              properties:
                text:
                  type: string
                  description: The text to analyze and potentially humanize
                  maxLength: 10000
                level:
                  type: string
                  enum: [light, medium, aggressive]
                  default: medium
                threshold:
                  type: integer
                  minimum: 0
                  maximum: 100
                  default: 40
                  description: AI probability threshold above which to humanize (0-100)
      responses:
        '200':
          description: Detection and humanization result
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DetectAndHumanizeResult'

components:
  schemas:
    DetectResult:
      type: object
      properties:
        probability:
          type: integer
          description: Likelihood text is AI-generated (0=human, 100=AI)
        label:
          type: string
          description: Human-readable verdict
        signals:
          type: array
          items:
            type: string
          description: Specific reasons for the score
        wordCount:
          type: integer
    HumanizeResult:
      type: object
      properties:
        original:
          type: string
        humanized:
          type: string
        changesApplied:
          type: integer
          description: Approximate number of word-level changes made
        level:
          type: string
    DetectAndHumanizeResult:
      type: object
      properties:
        detection:
          $ref: '#/components/schemas/DetectResult'
        humanized:
          type: string
          nullable: true
          description: Humanized text, or null if below threshold
        wasHumanized:
          type: boolean
        level:
          type: string
`.trim());
});

// ─── API ENDPOINTS ────────────────────────────────────────────

// POST /api/detect
app.post('/api/detect', (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text field is required and must be a string.' });
  }
  if (text.trim().length < 15) {
    return res.status(400).json({ error: 'Text is too short to analyze (minimum 15 characters).' });
  }
  const result = detectAI(text);
  res.json(result);
});

// POST /api/humanize
app.post('/api/humanize', (req, res) => {
  const { text, level = 'medium' } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text field is required and must be a string.' });
  }
  if (!['light', 'medium', 'aggressive'].includes(level)) {
    return res.status(400).json({ error: 'level must be one of: light, medium, aggressive' });
  }

  const humanized = humanize(text, level);
  const changesApplied = countWordDiff(text, humanized);

  res.json({ original: text, humanized, changesApplied, level });
});

// POST /api/detect-and-humanize
app.post('/api/detect-and-humanize', (req, res) => {
  const { text, level = 'medium', threshold = 40 } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text field is required and must be a string.' });
  }

  const detection = detectAI(text);
  let humanized = null;
  const wasHumanized = detection.probability >= threshold;

  if (wasHumanized) {
    humanized = humanize(text, level);
  }

  res.json({ detection, humanized, wasHumanized, level });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'AI Humanizer GPT Plugin' });
});

// Privacy Policy page
app.get('/privacy', (req, res) => {
  res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Privacy Policy — AI Humanizer Pro</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      background: #09090f;
      color: #c8c8d8;
      min-height: 100vh;
      padding: 0 0 60px;
    }
    header {
      background: linear-gradient(135deg, #0f0f1e 0%, #0f3460 100%);
      border-bottom: 1px solid rgba(229,160,13,0.25);
      padding: 36px 40px 28px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .logo {
      width: 48px; height: 48px;
      background: linear-gradient(135deg, #1a1a2e, #0f3460);
      border-radius: 50%;
      border: 2px solid rgba(229,160,13,0.5);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
    }
    .brand { display: flex; flex-direction: column; }
    .brand-name { color: #e5a00d; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .brand-sub  { color: #555; font-size: 13px; margin-top: 2px; }

    .container { max-width: 760px; margin: 0 auto; padding: 48px 32px 0; }

    h1 { color: #e5a00d; font-size: 28px; margin-bottom: 6px; }
    .updated { color: #444; font-size: 13px; margin-bottom: 40px; letter-spacing: 0.3px; }

    .summary-box {
      background: rgba(229,160,13,0.07);
      border: 1px solid rgba(229,160,13,0.2);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 40px;
    }
    .summary-box p { color: #c8b87a; font-size: 15px; line-height: 1.7; }
    .summary-box strong { color: #e5a00d; }

    section { margin-bottom: 36px; }
    h2 {
      color: #e5a00d;
      font-size: 17px;
      font-weight: 700;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(229,160,13,0.12);
      letter-spacing: 0.3px;
    }
    p { font-size: 15px; line-height: 1.8; color: #a0a0b8; margin-bottom: 12px; }
    ul { padding-left: 20px; margin-bottom: 12px; }
    li { font-size: 15px; line-height: 1.8; color: #a0a0b8; margin-bottom: 4px; }
    li::marker { color: #e5a00d; }
    a { color: #e5a00d; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .badge {
      display: inline-block;
      background: rgba(100,200,100,0.1);
      border: 1px solid rgba(100,200,100,0.25);
      color: #6bc87a;
      border-radius: 6px;
      padding: 3px 10px;
      font-size: 12px;
      font-family: monospace;
      margin-left: 8px;
      vertical-align: middle;
    }

    footer {
      margin-top: 60px;
      text-align: center;
      color: #333;
      font-size: 13px;
      border-top: 1px solid rgba(255,255,255,0.05);
      padding-top: 24px;
    }
    footer a { color: #555; }
  </style>
</head>
<body>
  <header>
    <div class="logo">✦</div>
    <div class="brand">
      <span class="brand-name">AI Humanizer Pro</span>
      <span class="brand-sub">GPT Action Plugin</span>
    </div>
  </header>

  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: February 2026</p>

    <div class="summary-box">
      <p>
        <strong>Short version:</strong> We do not collect, store, log, or share any text you submit.
        Every request is processed in memory and immediately discarded.
        No accounts. No tracking. No cookies. Completely free.
      </p>
    </div>

    <section>
      <h2>1. Who We Are</h2>
      <p>
        AI Humanizer Pro is a free, open-source GPT Action plugin that detects AI-generated text
        and rewrites it to sound more natural and human. The service is available at
        <a href="https://ai-humanizer-gpt.up.railway.app">ai-humanizer-gpt.up.railway.app</a>.
      </p>
    </section>

    <section>
      <h2>2. What Data We Collect <span class="badge">None</span></h2>
      <p>We do <strong>not</strong> collect or store any of the following:</p>
      <ul>
        <li>Text submitted for detection or humanization</li>
        <li>IP addresses or location data</li>
        <li>Browser or device information</li>
        <li>Usage history or session data</li>
        <li>Cookies or tracking identifiers</li>
        <li>Account information (no accounts exist)</li>
      </ul>
    </section>

    <section>
      <h2>3. How Your Text Is Processed</h2>
      <p>
        When you submit text to our API (via ChatGPT or directly), it is:
      </p>
      <ul>
        <li>Received by our server</li>
        <li>Processed entirely in memory (RAM)</li>
        <li>Returned to you as a response</li>
        <li>Immediately discarded — never written to disk or any database</li>
      </ul>
      <p>
        We have no capability to retrieve, review, or reconstruct any text you have submitted
        because it is never saved anywhere.
      </p>
    </section>

    <section>
      <h2>4. Third-Party Services</h2>
      <p>Our server is hosted on <strong>Railway.app</strong>. Railway may collect standard
      infrastructure-level logs (such as request timestamps and response codes) for operational
      purposes. These logs do not contain the content of your text submissions.</p>
      <p>You can review Railway's privacy policy at
        <a href="https://railway.app/legal/privacy" target="_blank">railway.app/legal/privacy</a>.
      </p>
    </section>

    <section>
      <h2>5. ChatGPT & OpenAI</h2>
      <p>
        When you use this plugin through ChatGPT, your conversation is also subject to
        OpenAI's privacy policy. We only receive the text that ChatGPT explicitly sends
        to our API endpoints — nothing more.
      </p>
    </section>

    <section>
      <h2>6. Rate Limiting</h2>
      <p>
        To prevent abuse, we enforce a limit of 30 requests per minute per IP address.
        This is enforced transiently in memory and IP addresses are not logged or stored
        beyond the current 60-second window.
      </p>
    </section>

    <section>
      <h2>7. Children's Privacy</h2>
      <p>
        This service is not directed at children under 13. We do not knowingly collect
        any information from children. Since we collect no data at all, no special
        provisions are required.
      </p>
    </section>

    <section>
      <h2>8. Changes to This Policy</h2>
      <p>
        If we update this privacy policy, the "Last updated" date at the top of this page
        will reflect the change. Continued use of the service after changes constitutes
        acceptance of the updated policy.
      </p>
    </section>

    <section>
      <h2>9. Contact</h2>
      <p>
        Questions about this privacy policy? The plugin is open source — you can review
        the full source code to verify our claims. If you have concerns, please open an
        issue on the GitHub repository.
      </p>
    </section>

    <footer>
      <p>© 2026 AI Humanizer Pro — Free & Open Source</p>
      <p style="margin-top:8px;">
        <a href="/">Home</a> &nbsp;·&nbsp;
        <a href="/api/health">API Status</a>
      </p>
    </footer>
  </div>
</body>
</html>`);
});

// Legal page (alias)
app.get('/legal', (req, res) => res.redirect('/privacy'));

// ─── HELPERS ─────────────────────────────────────────────────

function countWordDiff(a, b) {
  const wa = a.toLowerCase().split(/\s+/);
  const wb = b.toLowerCase().split(/\s+/);
  let diff = 0;
  const len = Math.max(wa.length, wb.length);
  for (let i = 0; i < len; i++) {
    if (wa[i] !== wb[i]) diff++;
  }
  return diff;
}

// ─── START ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 AI Humanizer GPT Plugin running on port ${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api/detect`);
  console.log(`   Manifest:  http://localhost:${PORT}/.well-known/ai-plugin.json`);
  console.log(`   OpenAPI:   http://localhost:${PORT}/openapi.yaml\n`);
});