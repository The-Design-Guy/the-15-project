// Vercel Serverless Function: POST /api/playlists
// Reads a compact summary of the user's own Spotify playlists and builds 4 workout playlists.
// Env: OPENAI_API_KEY (required), APP_TOKEN (optional), PLAYLIST_MODEL (optional, default gpt-4o-mini)
const hits=new Map();
function limited(ip){const now=Date.now(),arr=(hits.get(ip)||[]).filter(t=>now-t<60000);arr.push(now);hits.set(ip,arr);return arr.length>6;}
const PROFILES=['POWER HOUSE','MOVE FASTER','CHILL MOTION','FEEL GOOD'];
const track={type:'object',additionalProperties:false,required:['title','artist','fromUser'],properties:{title:{type:'string'},artist:{type:'string'},fromUser:{type:'boolean'}}};
const schema={type:'object',additionalProperties:false,required:['taste','lists'],properties:{
  taste:{type:'string'},
  lists:{type:'array',items:{type:'object',additionalProperties:false,required:['profile','description','tracks'],properties:{
    profile:{type:'string',enum:PROFILES},description:{type:'string'},tracks:{type:'array',items:track}}}}}};
const SYSTEM=`You are a music curator for THE 15 PROJECT, a 15-minute home workout app.
You receive the user's own Spotify playlists (names + track lists) and optionally their top artists.
1) Understand their taste: eras, genres, energy, favourite artists. Playlist names are personal (e.g. "KAT BALU FRIDAYS" may be a 2000s dance list) — infer from the tracks, not only the name.
2) Build exactly 4 workout playlists, one per profile:
- POWER HOUSE: strength sessions. Driving, steady groove. ~120–128 BPM.
- MOVE FASTER: cardio & agility. High energy. ~125–140 BPM.
- CHILL MOTION: mobility & recovery. Relaxed but moving. ~95–120 BPM.
- FEEL GOOD: upbeat, happy, sing-along energy. ~120–130 BPM.
Rules:
- Stay in the user's taste (same eras/genres/artists). Do NOT default to generic house if they like something else; adapt each profile's energy to their genres.
- About half the tracks should come from the user's own playlists when they fit the profile's energy (fromUser:true). The rest are real, well-known tracks they'd likely love (fromUser:false), similar artists/eras.
- Only real, existing songs, with the main artist name spelled as on Spotify. No duplicates within or across lists.
- Each list: exactly the requested number of tracks, ordered for a workout (build up, keep energy).
- "taste": one or two friendly sentences describing what you understood about their music.
- "description": one short line for the Spotify playlist description.`;
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const key=process.env.OPENAI_API_KEY;if(!key)return res.status(500).json({error:'Server is missing OPENAI_API_KEY'});
  const token=process.env.APP_TOKEN;if(token&&req.headers['x-app-token']!==token)return res.status(401).json({error:'Access code is missing or wrong.'});
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0].trim()||'unknown';if(limited(ip))return res.status(429).json({error:'Too many requests. Wait a minute.'});
  let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body);}catch(e){body=null;}}
  const pls=Array.isArray(body&&body.playlists)?body.playlists.slice(0,20):[];
  if(!pls.length)return res.status(400).json({error:'No playlists to read.'});
  const count=Math.max(10,Math.min(40,+(body&&body.count)||30));
  const summary=pls.map(p=>'## '+String(p.name||'').slice(0,80)+'\n'+(Array.isArray(p.tracks)?p.tracks.slice(0,80).map(t=>'- '+String(t).slice(0,120)).join('\n'):'')).join('\n\n').slice(0,40000);
  const top=Array.isArray(body&&body.topArtists)?body.topArtists.slice(0,30).map(String).join(', '):'';
  try{const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:process.env.PLAYLIST_MODEL||'gpt-4o-mini',temperature:0.6,messages:[{role:'system',content:SYSTEM},{role:'user',content:'Tracks per list: '+count+'\nTop artists: '+(top||'(not available)')+'\n\nMY PLAYLISTS:\n'+summary}],
        response_format:{type:'json_schema',json_schema:{name:'workout_playlists',strict:true,schema}}})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status===429?429:502).json({error:(j.error&&j.error.message)||('OpenAI error '+r.status)});
    let out;try{out=JSON.parse(j.choices[0].message.content);}catch(e){return res.status(502).json({error:'AI response could not be read.'});}
    return res.status(200).json(out);
  }catch(e){return res.status(502).json({error:'Could not reach the AI service.'});}
};
