// Vercel Serverless Function: POST /api/transcribe (longer free-form speech for onboarding)
// Receives a short audio clip, transcribes it with OpenAI, returns { text }.
// The browser then maps the text to an allowlisted action (see runVoice in index.html).
// Env: OPENAI_API_KEY (required), APP_TOKEN (optional shared secret), VOICE_MODEL (optional)

const MAX_BYTES = 4_000_000; // ~60s of compressed audio
const ALLOWED = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac)/i;
const hits = new Map(); // best-effort per-instance rate limit

function limited(ip) {
  const now = Date.now(), win = 60_000, max = 20;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BYTES) { reject(Object.assign(new Error('Audio too long'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY' });

  const token = process.env.APP_TOKEN;
  if (token && req.headers['x-app-token'] !== token) return res.status(401).json({ error: 'Voice access code is missing or wrong (Settings).' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'Too many voice requests. Wait a minute.' });

  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (!ALLOWED.test(type)) return res.status(415).json({ error: 'Unsupported audio format: ' + (type || 'none') });

  let audio;
  try { audio = await readBody(req); }
  catch (e) { return res.status(e.code || 400).json({ error: e.message }); }
  if (audio.length < 1000) return res.status(400).json({ error: 'Recording was empty. Try again.' });

  const ext = type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'm4a'
    : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mpeg') || type.includes('mp3') ? 'mp3' : 'webm';

  const lang = String(req.query && req.query.lang || '');
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), 'speech.' + ext);
  form.append('model', process.env.VOICE_MODEL || 'gpt-4o-mini-transcribe');
  if (lang === 'en' || lang === 'he') form.append('language', lang);
  form.append('prompt', 'A person explaining in their own words why they want to start exercising: goals, age, activity level, time, injuries, family.');

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || ('OpenAI error ' + r.status);
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }
    const text = String(j.text || '').trim().slice(0, 3000);
    // audio and transcript are not stored
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach OpenAI.' });
  }
};
