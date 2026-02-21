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

// Legal page (required for plugin manifest)
app.get('/legal', (req, res) => {
  res.send('<h1>AI Humanizer Pro — Terms</h1><p>Free to use. No data is stored. Rate limits apply.</p>');
});

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