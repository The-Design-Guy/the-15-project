// Room scan: the computer opens a session and shows a QR code; the phone films the room (8 photos in a circle),
// the photos go to Vercel Blob, the AI reads the room from them, the phone confirms, and the computer builds the scene.
//
//   POST ?a=new                      (admin)  → { id }                        a new session, 30 minutes
//   GET  ?a=status&id=…              (admin)  → the session                   the computer polls this
//   POST ?a=photo&id=…&n=0..7        (phone)  raw JPEG/WebP body → { url }    one photo
//   POST ?a=analyze&id=…             (phone)  JSON { known:{ what:'back'|'side'|'height', m } }? → { result }   the AI reads the room
//   POST ?a=confirm&id=…             (phone)  JSON { result } → { ok }        the (corrected) room goes to the computer
//   POST ?a=cancel&id=…              (either)
//   POST ?a=new&share=1              (admin)  → { id, exp }                   a link to send to someone else: works for an hour
//   POST ?a=ask&id=…                 (phone)  → { wa, by }                    the link expired: ask the agent for more time
//   POST ?a=extend&id=…              (admin)  → { exp }                       one more hour for the same link
//   GET  ?a=check&id=…               (phone)  → { ok, share, exp }            is the link still good
//
// The phone has no admin password: the session id (random, 20 characters, 30 minutes) is what lets it in.
import { randomBytes } from 'node:crypto';
import { isAdmin } from './_auth.js';
import { redis } from './_redis.js';

export const config = { maxDuration: 60 };
const TTL = 1800, MAX_PHOTOS = 8;
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1';
const TYPES = { 'image/webp':'webp', 'image/jpeg':'jpg', 'image/png':'png' };
const key = (id) => `scan:${id}`;

async function load(id) {
  if (!/^[a-z0-9]{20}$/.test(id || '')) return null;
  const raw = await redis(['GET', key(id)]);
  return raw ? JSON.parse(raw) : null;
}
const SHARE_TTL = 3600, KEEP = 7 * 86400;           // a shared link works for an hour; its result is kept for a week
const save = (id, s) => redis(['SET', key(id), JSON.stringify(s), 'EX', String(s.share ? KEEP : TTL)]);
async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try { return JSON.parse((await rawBody(req)).toString('utf8') || '{}'); } catch { return {}; }
}

const nul = (t) => ({ anyOf:[t, { type:'null' }] });
const SCHEMA = { type:'object', additionalProperties:false,
  required:['ok', 'problem', 'width_m', 'depth_m', 'height_m', 'confidence', 'walls', 'openings', 'floor', 'wall_color', 'style', 'description_he', 'description_en'],
  properties:{
    ok:{ type:'boolean', description:'false if the photos do not show a room clearly enough (too dark, blurred, the same view again and again)' },
    problem:{ type:'string', description:'Hebrew, short: what is wrong with the photos when ok is false; empty otherwise' },
    width_m:{ type:'number', description:'the length of the BACK wall (photo 1), in metres' },
    depth_m:{ type:'number', description:'the length of the side walls (photos 3 and 7), in metres' },
    height_m:{ type:'number' },
    confidence:{ type:'string', enum:['low', 'medium', 'high'] },
    walls:{ type:'object', additionalProperties:false, required:['back', 'left', 'right', 'front'], properties:{
      back:{ type:'boolean' }, left:{ type:'boolean' }, right:{ type:'boolean' }, front:{ type:'boolean' } }, description:'true = a solid wall (false = open to another space)' },
    openings:{ type:'array', items:{ type:'object', additionalProperties:false, required:['kind', 'type', 'wall', 'width_cm', 'height_cm', 'offset_cm', 'sill_cm'], properties:{
      kind:{ type:'string', enum:['door', 'window'] },
      type:{ type:'string', enum:['single', 'double', 'sliding', 'passage', 'std', 'shop', 'high'], description:'door: single / double / sliding (glass) / passage (an opening with no door). window: std / shop (large shop front) / high (high, narrow)' },
      wall:{ type:'string', enum:['back', 'left', 'right', 'front'] },
      width_cm:{ type:'number' }, height_cm:{ type:'number' },
      offset_cm:{ type:'number', description:'distance from the corner: on the back and front walls from the LEFT wall; on the side walls from the BACK wall' },
      sill_cm:{ type:'number', description:'window: height of its bottom above the floor; door: 0' } } } },
    floor:{ type:'string', description:'Hebrew: the floor, e.g. "פרקט עץ בהיר", "אריחים אפורים"' },
    wall_color:{ type:'string', description:'Hebrew: colour / finish of the walls' },
    style:{ type:'string', description:'Hebrew: what kind of place it is and its style, e.g. "חנות ממתקים צבעונית", "מחסן תעשייתי"' },
    description_he:{ type:'string', description:'Hebrew, 1–2 sentences describing the room for the realistic render (floor, walls, ceiling, light, atmosphere). No furniture that will be replaced.' },
    description_en:{ type:'string', description:'the same in English' },
  } };

const SYSTEM = `You read a room from 8 photos taken by someone standing near the middle of it and turning clockwise (to the right), 45° between photos.
Photo 1 faces the BACK wall. Photo 3 faces the RIGHT wall, photo 5 the FRONT wall (behind the starting direction), photo 7 the LEFT wall; photos 2, 4, 6, 8 show the corners between them.
Estimate the room's size from things of known size: doors are about 200–210 cm high and 80–90 cm wide, ceilings about 260–300 cm, floor tiles 60 cm, power sockets about 30 cm above the floor, a kitchen counter 90 cm.
List every door, doorway and window you can see, on the wall it is in, with its size and position. Keep the same wall names (back / right / front / left) as defined above.
Be honest about how sure you are (confidence). Answer only with the JSON.`;

const agent = (b) => ({ wa:String(b?.wa || '').replace(/[^0-9]/g, '').replace(/^0/, '972').slice(0, 15), by:String(b?.by || '').slice(0, 40) });
export default async function handler(req, res) {
  const a = String(req.query?.a || ''), id = String(req.query?.id || '');
  try {
    if (a === 'new') {
      if (req.method !== 'POST') return res.status(405).json({ error:'method not allowed' });
      if (!isAdmin(req)) return res.status(401).json({ error:'נדרש מצב ניהול' });
      if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return res.status(501).json({ error:'לא חובר אחסון תמונות (Vercel Blob) – ראו README' });
      const nid = randomBytes(15).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(20, '0').slice(0, 20);
      const share = String(req.query?.share || '') === '1', now = Date.now();
      await save(nid, { status:'waiting', created:now, photos:Array(MAX_PHOTOS).fill(null), result:null, error:'', ...(share ? { share:true, exp:now + SHARE_TTL * 1000, ...agent(await jsonBody(req)) } : {}) });
      return res.status(200).json({ id:nid, ttl:share ? SHARE_TTL : TTL, exp:share ? now + SHARE_TTL * 1000 : now + TTL * 1000 });
    }
    const s = await load(id);
    if (!s) return res.status(404).json({ error:'הסשן לא נמצא או שפג תוקפו – סרקו שוב את הברקוד מהמחשב' });

    const expired = s.share && Date.now() > s.exp && s.status !== 'done';
    if (a === 'check') return res.status(200).json({ ok:!expired && s.status !== 'cancelled' && s.status !== 'done', share:!!s.share, exp:s.exp || null, status:s.status, ask:!!s.ask, wa:s.wa || '' });
    if (a === 'status') {
      if (!isAdmin(req)) return res.status(401).json({ error:'נדרש מצב ניהול' });
      return res.status(200).json(s);
    }
    // an expired shared link: the phone asks for more time, the agent (any admin) extends the same link with one tap
    if (a === 'ask') {
      if (req.method !== 'POST') return res.status(405).json({ error:'method not allowed' });
      if (!s.share) return res.status(400).json({ error:'רק לקישור ששלחו לכם' });
      if (!s.ask) { s.ask = Date.now(); await save(id, s); }
      return res.status(200).json({ ok:true, wa:s.wa || '', by:s.by || '' });
    }
    if (a === 'extend') {
      if (req.method !== 'POST') return res.status(405).json({ error:'method not allowed' });
      if (!isAdmin(req)) return res.status(401).json({ error:'נדרש מצב ניהול' });
      if (s.status === 'done') return res.status(200).json({ ok:true, done:true });
      s.exp = Date.now() + SHARE_TTL * 1000; s.ask = 0; if (s.status === 'cancelled') s.status = 'waiting';
      await save(id, s);
      return res.status(200).json({ ok:true, exp:s.exp });
    }
    if (req.method !== 'POST') return res.status(405).json({ error:'method not allowed' });
    if (s.status === 'cancelled') return res.status(410).json({ error:'הצילום בוטל במחשב' });
    if (expired && a !== 'cancel') return res.status(410).json({ error:'הקישור פג תוקף (הוא תקף לשעה) – בקשו קישור חדש' });

    if (a === 'photo') {
      const n = Number(req.query?.n);
      if (!Number.isInteger(n) || n < 0 || n >= MAX_PHOTOS) return res.status(400).json({ error:'מספר תמונה לא תקין' });
      const type = String(req.headers['content-type'] || '').split(';')[0];
      if (!TYPES[type]) return res.status(400).json({ error:'רק JPG, WebP או PNG' });
      const buf = await rawBody(req);
      if (!buf.length || buf.length > 4_300_000) return res.status(413).json({ error:'התמונה גדולה מדי' });
      const { put } = await import('@vercel/blob');
      const r = await put(`scans/${id}/${n + 1}.${TYPES[type]}`, buf, { access:'public', contentType:type, addRandomSuffix:true });
      const cur = await load(id) || s;                                   // photos may arrive close together
      cur.photos[n] = r.url; cur.status = 'capturing'; cur.error = '';
      await save(id, cur);
      return res.status(200).json({ url:r.url, count:cur.photos.filter(Boolean).length });
    }
    if (a === 'analyze') {
      const urls = s.photos.filter(Boolean);
      if (urls.length < 4) return res.status(400).json({ error:'צריך לפחות 4 תמונות' });
      if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error:'OPENAI_API_KEY is not set' });
      s.status = 'analyzing'; await save(id, s);
      // one measurement the person knows anchors the scale (photos alone give no real size)
      const kb = await jsonBody(req), KN = { back:'the BACK wall (photo 1) is', side:'each SIDE wall (photos 3 and 7) is', height:'the ceiling height is' };
      const known = kb && KN[kb.known?.what] && +kb.known.m > 0.5 && +kb.known.m < 200 ? { what:kb.known.what, m:+kb.known.m } : null;
      const content = [];
      if (known) content.push({ type:'text', text:`MEASURED BY THE PERSON (exact – use it as the scale for everything else, and keep the proportions you see): ${KN[known.what]} ${known.m} m.` });
      content.push({ type:'text', text:`The photos, in order (${s.photos.map((u, k) => u ? 'photo ' + (k + 1) : '').filter(Boolean).join(', ')}):` });
      s.photos.forEach((u, k) => { if (u) content.push({ type:'text', text:`Photo ${k + 1}:` }, { type:'image_url', image_url:{ url:u, detail:'high' } }); });
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST', headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}`, 'content-type':'application/json' },
        body:JSON.stringify({ model:VISION_MODEL, temperature:0, response_format:{ type:'json_schema', json_schema:{ name:'room_scan', strict:true, schema:SCHEMA } },
          messages:[{ role:'system', content:SYSTEM }, { role:'user', content }] }),
      });
      const j = await r.json();
      if (!r.ok) { s.status = 'capturing'; s.error = j.error?.message || `OpenAI ${r.status}`; await save(id, s); return res.status(502).json({ error:s.error }); }
      const out = JSON.parse(j.choices?.[0]?.message?.content || '{}');
      if (known && out.ok) {                                              // the measured one is exact
        if (known.what === 'back') out.width_m = known.m; else if (known.what === 'side') out.depth_m = known.m; else out.height_m = known.m;
        out.known = known;
      }
      s.result = out; s.status = out.ok ? 'review' : 'capturing'; s.error = out.ok ? '' : out.problem;
      await save(id, s);
      return res.status(200).json({ result:out });
    }
    if (a === 'confirm') {
      const b = await jsonBody(req), r = b.result || s.result;
      if (!r) return res.status(400).json({ error:'אין עדיין ניתוח של החדר' });
      s.result = r; s.status = 'done'; await save(id, s);
      return res.status(200).json({ ok:true });
    }
    if (a === 'cancel') { s.status = 'cancelled'; await save(id, s); return res.status(200).json({ ok:true }); }
    return res.status(400).json({ error:'unknown action' });
  } catch (e) {
    return res.status(500).json({ error:e.message });
  }
}
