// ============================================================
//  engine.js  —  AI Detector + Humanizer Core Logic
// ============================================================

// ─── DETECTION ──────────────────────────────────────────────

// Words/phrases heavily associated with LLM output
const AI_MARKERS = [
    // Buzzwords
    'delve','delves','delved','delving','tapestry','nuance','nuanced',
    'multifaceted','utilize','utilizes','utilized','leveraging','leverage',
    'pivotal','crucial','vital','paramount','imperative','robust','seamlessly',
    'streamline','innovative','cutting-edge','state-of-the-art','groundbreaking',
    'transformative','comprehensive','holistic','synergy','paradigm',
    'facilitate','facilitates','aligns','align','encompass','encompasses',
    'embark','embarks','journey','foster','fosters','underscore','underscores',
    'it is worth noting','it is important to note','it should be noted',
    'in conclusion','to summarize','in summary','in closing',
    'furthermore','moreover','nevertheless','notwithstanding','henceforth',
    'consequently','subsequently','additionally','notably',
    // AI sign-off phrases
    'i hope this helps','feel free to ask','let me know if you',
    'as an ai','as a language model','i cannot','i am unable to',
    'certainly!','absolutely!','of course!','great question',
  ];
  
  // Structural signals of AI text
  function analyzeStructure(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length === 0) return { score: 0, signals: [] };
  
    const signals = [];
    let score = 0;
  
    // 1. Sentence length variance — AI tends to be very uniform
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 5 && sentences.length > 3) {
      score += 20;
      signals.push('Very uniform sentence length (low variance)');
    }
  
    // 2. Passive voice density
    const passiveMatches = text.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi) || [];
    const passiveRatio = passiveMatches.length / sentences.length;
    if (passiveRatio > 0.4) {
      score += 15;
      signals.push('High passive voice density');
    }
  
    // 3. Transition word overuse
    const transitions = ['however','furthermore','moreover','additionally','consequently',
      'subsequently','nevertheless','notwithstanding','in conclusion','to summarize',
      'in addition','on the other hand','in contrast','as a result','therefore','thus'];
    const transCount = transitions.filter(t => new RegExp(`\\b${t}\\b`, 'i').test(text)).length;
    if (transCount >= 3) {
      score += transCount * 5;
      signals.push(`Overuse of formal transition words (${transCount} found)`);
    }
  
    // 4. Lists / bullet structure
    const bulletLines = (text.match(/^\s*[-•*]\s+/gm) || []).length;
    const numberedLines = (text.match(/^\s*\d+\.\s+/gm) || []).length;
    if (bulletLines + numberedLines >= 3) {
      score += 10;
      signals.push('Heavy use of bullet/numbered lists');
    }
  
    // 5. All-caps headers / bold markdown
    const headers = (text.match(/#{1,3}\s+\w+/g) || []).length;
    if (headers >= 2) { score += 10; signals.push('Markdown headers present'); }
  
    // 6. Average word complexity (syllable proxy via length)
    const words = text.replace(/[^a-z ]/gi, '').split(/\s+/).filter(Boolean);
    const longWords = words.filter(w => w.length > 9).length;
    const longRatio = longWords / words.length;
    if (longRatio > 0.18) {
      score += 12;
      signals.push('High proportion of long/complex words');
    }
  
    // 7. Lack of personal pronouns
    const firstPerson = (text.match(/\b(I|me|my|we|our|I've|I'm|I'd|I'll)\b/g) || []).length;
    const wordCount = words.length;
    if (wordCount > 80 && firstPerson / wordCount < 0.01) {
      score += 8;
      signals.push('Very low first-person pronoun usage');
    }
  
    return { score, signals, avg, stdDev };
  }
  
  function detectAI(text) {
    if (!text || text.trim().length < 30) {
      return { probability: 0, label: 'Too short to analyze', signals: [], score: 0 };
    }
  
    const lower = text.toLowerCase();
    let markerScore = 0;
    const foundMarkers = [];
  
    for (const marker of AI_MARKERS) {
      if (lower.includes(marker)) {
        markerScore += marker.length > 15 ? 8 : 4;
        foundMarkers.push(marker);
      }
    }
  
    const { score: structScore, signals } = analyzeStructure(text);
  
    // Total raw score → clamp to 0-100
    const raw = Math.min(100, markerScore + structScore);
    const probability = Math.round(raw);
  
    let label;
    if (probability >= 80) label = 'Very likely AI-generated';
    else if (probability >= 60) label = 'Likely AI-generated';
    else if (probability >= 40) label = 'Possibly AI-generated';
    else if (probability >= 20) label = 'Mostly human-written';
    else label = 'Likely human-written';
  
    return {
      probability,
      label,
      signals: [...signals, ...foundMarkers.slice(0, 6).map(m => `AI marker: "${m}"`)],
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }
  
  // ─── HUMANIZATION ────────────────────────────────────────────
  
  const SYNONYM_MAP = {
    // Formal → casual
    'utilize': 'use', 'utilizes': 'uses', 'utilized': 'used', 'utilizing': 'using',
    'implement': 'apply', 'implementing': 'applying', 'implemented': 'applied',
    'leverage': 'use', 'leverages': 'uses', 'leveraged': 'used', 'leveraging': 'using',
    'facilitate': 'help', 'facilitates': 'helps', 'facilitated': 'helped',
    'demonstrate': 'show', 'demonstrates': 'shows', 'demonstrated': 'showed',
    'indicate': 'show', 'indicates': 'shows', 'indicated': 'showed',
    'obtain': 'get', 'obtains': 'gets', 'obtained': 'got',
    'provide': 'give', 'provides': 'gives', 'provided': 'gave',
    'require': 'need', 'requires': 'needs', 'required': 'needed',
    'commence': 'start', 'commences': 'starts', 'commenced': 'started',
    'terminate': 'end', 'terminates': 'ends', 'terminated': 'ended',
    'additional': 'more', 'numerous': 'many', 'sufficient': 'enough',
    'approximately': 'about', 'frequently': 'often', 'subsequently': 'then',
    'previously': 'before', 'currently': 'now', 'consequently': 'so',
    'therefore': 'so', 'furthermore': 'also', 'moreover': 'also',
    'nevertheless': 'still', 'thus': 'so', 'henceforth': 'from now on',
    'delve': 'dive', 'delves': 'dives', 'delved': 'dived', 'delving': 'diving',
    'tapestry': 'mix', 'paradigm': 'approach', 'synergy': 'teamwork',
    'holistic': 'complete', 'robust': 'strong', 'seamlessly': 'smoothly',
    'streamline': 'simplify', 'innovative': 'new', 'cutting-edge': 'modern',
    'state-of-the-art': 'advanced', 'transformative': 'game-changing',
    'groundbreaking': 'new', 'comprehensive': 'complete', 'pivotal': 'key',
    'crucial': 'key', 'vital': 'important', 'paramount': 'top',
    'underscore': 'highlight', 'underscores': 'highlights',
    'encompass': 'include', 'encompasses': 'includes',
    'foster': 'build', 'fosters': 'builds',
    'embark': 'start', 'embarks': 'starts',
    'optimal': 'best', 'enhanced': 'improved',
    // Long filler phrases → shorter
    'in order to': 'to',
    'due to the fact that': 'because',
    'in the event that': 'if',
    'with regard to': 'about',
    'in addition to': 'besides',
    'as a result of': 'because of',
    'in spite of': 'despite',
    'for the purpose of': 'to',
    'it is important to note that': 'Note:',
    'it should be noted that': 'Note:',
    'it is worth noting that': '',
    'it is worth mentioning that': '',
    'in conclusion,': 'To wrap up,',
    'to summarize,': 'In short,',
    'in summary,': 'In short,',
  };
  
  const CONTRACTIONS = [
    [/\bit is\b/g, "it's"], [/\bI am\b/g, "I'm"], [/\bthey are\b/g, "they're"],
    [/\bwe are\b/g, "we're"], [/\byou are\b/g, "you're"], [/\bhe is\b/g, "he's"],
    [/\bshe is\b/g, "she's"], [/\bthat is\b/g, "that's"], [/\bthere is\b/g, "there's"],
    [/\bdo not\b/g, "don't"], [/\bdoes not\b/g, "doesn't"], [/\bdid not\b/g, "didn't"],
    [/\bcannot\b/g, "can't"], [/\bwill not\b/g, "won't"], [/\bwould not\b/g, "wouldn't"],
    [/\bshould not\b/g, "shouldn't"], [/\bcould not\b/g, "couldn't"],
    [/\bhave not\b/g, "haven't"], [/\bhas not\b/g, "hasn't"], [/\bhad not\b/g, "hadn't"],
    [/\bI have\b/g, "I've"], [/\bthey have\b/g, "they've"], [/\bwe have\b/g, "we've"],
    [/\bI would\b/g, "I'd"], [/\bI will\b/g, "I'll"], [/\bthey will\b/g, "they'll"],
  ];
  
  function replaceSynonyms(text) {
    const sorted = Object.entries(SYNONYM_MAP).sort((a, b) => b[0].length - a[0].length);
    for (const [from, to] of sorted) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'gi');
      text = text.replace(re, (match) => {
        if (!to) return '';
        return match[0] === match[0].toUpperCase()
          ? to.charAt(0).toUpperCase() + to.slice(1)
          : to;
      });
    }
    return text;
  }
  
  function applyContractions(text) {
    for (const [pattern, replacement] of CONTRACTIONS) {
      text = text.replace(pattern, replacement);
    }
    return text;
  }
  
  function varyPunctuation(text) {
    return text.replace(/,\s(and|but|so|yet)\s/g, (m, conj) => {
      const r = Math.random();
      if (r < 0.25) return ` — ${conj} `;
      if (r < 0.45) return `; ${conj} `;
      return m;
    });
  }
  
  function removeAISentences(text) {
    // Strip common AI opening/closing fluff
    const fluff = [
      /^(Certainly!|Absolutely!|Of course!|Sure!|Great question!)\s*/i,
      /^(As an AI[^.]*\.)\s*/i,
      /I hope this (helps|answers)[^.]*\.\s*$/i,
      /Feel free to (ask|reach out)[^.]*\.\s*$/i,
      /Let me know if you (have|need)[^.]*\.\s*$/i,
      /Please (let me know|don't hesitate)[^.]*\.\s*$/i,
    ];
    for (const re of fluff) text = text.replace(re, '');
    return text.trim();
  }
  
  function humanize(text, level = 'medium') {
    if (!text || text.trim().length < 10) return text;
  
    let result = removeAISentences(text);
    result = replaceSynonyms(result);
    result = applyContractions(result);
  
    if (level === 'aggressive') {
      result = varyPunctuation(result);
      // Break overly long sentences (>35 words) at coordinating conjunctions
      result = result.replace(/([^.!?]{180,}?),\s(and|but|so)\s/g, '$1. ');
    }
  
    result = result.replace(/\s{2,}/g, ' ').trim();
    result = result.replace(/,\s*\./g, '.');
  
    return result;
  }
  
  module.exports = { detectAI, humanize };