// Vercel Serverless Function: POST /api/playlists
// mode "taste": read user's playlists -> taste summary + suggested direction per workout mode.
// mode "build": build/update 4 workout playlists using the user's per-mode preferences.
// Env: OPENAI_API_KEY (required), APP_TOKEN (optional), PLAYLIST_MODEL (optional, default gpt-4o-mini)
const hits=new Map();
function limited(ip){const now=Date.now(),arr=(hits.get(ip)||[]).filter(t=>now-t<60000);arr.push(now);hits.set(ip,arr);return arr.length>10;}
const PROFILES=['POWER HOUSE','MOVE FASTER','CHILL MOTION','FEEL GOOD'];
const MODES=`Workout modes:
- POWER HOUSE: strength sessions. Driving, steady groove. ~120–128 BPM.
- MOVE FASTER: cardio & agility. High energy. ~125–140 BPM.
- CHILL MOTION: mobility & recovery. Relaxed but moving. ~95–120 BPM.
- FEEL GOOD: upbeat, happy, sing-along energy. ~120–130 BPM.`;
const T={type:'object',additionalProperties:false,required:['title','artist'],properties:{title:{type:'string'},artist:{type:'string'}}};
const TU={type:'object',additionalProperties:false,required:['title','artist','fromUser'],properties:{title:{type:'string'},artist:{type:'string'},fromUser:{type:'boolean'}}};
const tasteSchema={type:'object',additionalProperties:false,required:['taste','suggestions'],properties:{taste:{type:'string'},
  suggestions:{type:'array',items:{type:'object',additionalProperties:false,required:['profile','suggestion'],properties:{profile:{type:'string',enum:PROFILES},suggestion:{type:'string'}}}}}};
const buildSchema={type:'object',additionalProperties:false,required:['lists'],properties:{
  lists:{type:'array',items:{type:'object',additionalProperties:false,required:['profile','description','tracks','remove'],properties:{
    profile:{type:'string',enum:PROFILES},description:{type:'string'},tracks:{type:'array',items:TU},remove:{type:'array',items:T}}}}}};
const TASTE_SYS=`You are a music curator for THE 15 PROJECT, a 15-minute home workout app.
You receive the user's own Spotify playlists (names + tracks) and optionally top artists.
Understand their taste: eras, genres, energy, favourite artists. Playlist names are personal (e.g. "KAT BALU FRIDAYS" may be a 2000s dance list) — infer from the tracks.
Return:
- "taste": 1–2 friendly sentences (second person) on what you understood.
- "suggestions": for each of the 4 modes, one short editable line proposing what to put there IN THEIR STYLE: example artists, songs and eras (e.g. "2000s dance anthems — Eric Prydz, Benny Benassi, Bob Sinclar; peak-time energy").
${MODES}`;
const BUILD_SYS=`You are a music curator for THE 15 PROJECT, a 15-minute home workout app.
Build workout playlists for the requested modes, following the user's instructions per mode (artists, songs, eras) and their overall taste.
${MODES}
Rules:
- Follow each mode's instructions closely; adapt the energy to the mode.
- Mix songs from the user's own playlists that fit (fromUser:true) with real, well-known songs they'd love (fromUser:false).
- Only real, existing songs; main artist spelled as on Spotify. No duplicates within or across lists.
- If a mode has an EXISTING playlist: "tracks" = only NEW songs to add (never repeat existing ones), up to the requested count. If remove is requested for it, put in "remove" the existing songs that clearly don't fit the mode's style/energy or the instructions (copy title and artist exactly as given); otherwise "remove" = [].
- For modes without an existing playlist: exactly the requested number of tracks, ordered for a workout; "remove" = [].
- "description": one short line for the Spotify playlist description.
- Return one list per requested mode only.`;
async function ai(key,sys,user,schema,name){const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({model:process.env.PLAYLIST_MODEL||'gpt-4o-mini',temperature:0.6,messages:[{role:'system',content:sys},{role:'user',content:user}],response_format:{type:'json_schema',json_schema:{name,strict:true,schema}}})});
  const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error((j.error&&j.error.message)||('OpenAI error '+r.status));e.status=r.status===429?429:502;throw e;}
  return JSON.parse(j.choices[0].message.content);}
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const key=process.env.OPENAI_API_KEY;if(!key)return res.status(500).json({error:'Server is missing OPENAI_API_KEY'});
  const token=process.env.APP_TOKEN;if(token&&req.headers['x-app-token']!==token)return res.status(401).json({error:'Access code is missing or wrong.'});
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0].trim()||'unknown';if(limited(ip))return res.status(429).json({error:'Too many requests. Wait a minute.'});
  let b=req.body;if(typeof b==='string'){try{b=JSON.parse(b);}catch(e){b=null;}}b=b||{};
  const pls=Array.isArray(b.playlists)?b.playlists.slice(0,20):[];
  const summary=pls.map(p=>'## '+String(p.name||'').slice(0,80)+'\n'+(Array.isArray(p.tracks)?p.tracks.slice(0,80).map(t=>'- '+String(t).slice(0,120)).join('\n'):'')).join('\n\n').slice(0,36000);
  const top=Array.isArray(b.topArtists)?b.topArtists.slice(0,30).map(String).join(', '):'';
  try{
    if(b.mode==='taste'){if(!pls.length)return res.status(400).json({error:'No playlists to read.'});
      const out=await ai(key,TASTE_SYS,'Top artists: '+(top||'(not available)')+'\n\nMY PLAYLISTS:\n'+summary,tasteSchema,'taste');return res.status(200).json(out);}
    const count=Math.max(5,Math.min(40,+b.count||30));
    const modes=(Array.isArray(b.modes)?b.modes:[]).filter(m=>m&&PROFILES.includes(m.profile)).slice(0,4);if(!modes.length)return res.status(400).json({error:'No modes requested.'});
    const req2=modes.map(m=>'### '+m.profile+'\nInstructions: '+String(m.prefs||'(none — use their taste)').slice(0,600)+'\n'+(Array.isArray(m.existing)&&m.existing.length?('EXISTING playlist ('+m.existing.length+' songs). Remove misfits: '+(m.remove?'YES':'NO')+'. Add up to '+count+' new songs.\n'+m.existing.slice(0,120).map(t=>'- '+String(t).slice(0,120)).join('\n')):('NEW playlist: exactly '+count+' songs.'))).join('\n\n');
    const out=await ai(key,BUILD_SYS,'Their taste: '+String(b.taste||'').slice(0,600)+'\nTop artists: '+(top||'(not available)')+'\n\nREQUESTED MODES:\n'+req2+'\n\nMY PLAYLISTS (for reference):\n'+summary.slice(0,24000),buildSchema,'workout_playlists');
    return res.status(200).json(out);
  }catch(e){return res.status(e.status||502).json({error:e.message||'Could not reach the AI service.'});}
};
