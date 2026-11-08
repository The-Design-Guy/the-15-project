// Vercel Serverless Function: POST /api/onboard
// Onboarding conversation + structured extraction. Returns schema-validated JSON.
// Env: OPENAI_API_KEY (required), APP_TOKEN (optional), ONBOARD_MODEL (optional, default gpt-4o-mini)
const hits=new Map();
function limited(ip){const now=Date.now(),arr=(hits.get(ip)||[]).filter(t=>now-t<60000);arr.push(now);hits.set(ip,arr);return arr.length>30;}
const GOALS=['strength','endurance','fat_loss','mobility','health','consistency','energy'];
const ACT=['sedentary','light','moderate','active'];
const FAM=['solo','partner','family','unsure'];
const EVID=['stated','inferred','none'];
const nul=t=>({type:[t,'null']});
const schema={type:'object',additionalProperties:false,required:['reply','followUpQuestion','followUpOptions','extracted','evidence','summary','readyToContinue','safetyFlag'],properties:{
  reply:{type:'string'},followUpQuestion:nul('string'),followUpOptions:{type:'array',items:{type:'string'}},
  extracted:{type:'object',additionalProperties:false,required:['name','age','gender','primaryGoal','secondaryGoals','currentActivityLevel','limitations','availableDays','familyInterest','personalReason'],properties:{
    name:nul('string'),age:nul('integer'),gender:{type:['string','null'],enum:['male','female',null]},primaryGoal:{type:['string','null'],enum:GOALS.concat([null])},
    secondaryGoals:{type:'array',items:{type:'string',enum:GOALS}},currentActivityLevel:{type:['string','null'],enum:ACT.concat([null])},
    limitations:{type:'array',items:{type:'string'}},availableDays:nul('integer'),familyInterest:{type:['string','null'],enum:FAM.concat([null])},personalReason:nul('string')}},
  evidence:{type:'object',additionalProperties:false,required:['name','age','gender','primaryGoal','currentActivityLevel','limitations','availableDays','familyInterest'],properties:Object.fromEntries(['name','age','gender','primaryGoal','currentActivityLevel','limitations','availableDays','familyInterest'].map(k=>[k,{type:'string',enum:EVID}]))},
  summary:{type:'string'},readyToContinue:{type:'boolean'},safetyFlag:{type:'boolean'}}};
const SYSTEM=['You are the onboarding guide for THE 15 PROJECT, a home fitness app built on 15-minute bodyweight sessions (12-week program, 18 beginner-friendly exercises, optional Family Mode with kids).',
'Goal: understand why the user wants to start, extract structured info, and ask at most ONE short follow-up question per turn, only when needed for the plan.',
'Information that matters for the plan: primary goal, current activity level, physical limitations/pain, available days per week, interest in working out with partner/family. Name, age and gender are nice-to-have; never ask for them here.',
'Tone: warm, concise (max 2 short sentences), practical, non-judgmental. No exaggerated praise, no guilt, no promises about weight loss or timelines. English only.',
'Never diagnose or give medical advice. If the user reports pain, injury, pregnancy, heart/breathing issues or a medical condition, set safetyFlag true and gently suggest checking with a health professional; keep going.',
'Evidence: "stated" only if the user said it explicitly; "inferred" if you deduced it; "none" if unknown. Never invent values. Keep previously known values unless the user corrects them.',
'followUpOptions: 2-5 short tappable answers for your question, or [] if none. Set readyToContinue true once you know the primary goal and activity level (or after 3 user turns). When ready, followUpQuestion is null.',
'summary: one natural sentence summarising what you understood, addressed to the user ("You want to ...").'].join('\n');
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const key=process.env.OPENAI_API_KEY;if(!key)return res.status(500).json({error:'Server is missing OPENAI_API_KEY'});
  const token=process.env.APP_TOKEN;if(token&&req.headers['x-app-token']!==token)return res.status(401).json({error:'Access code is missing or wrong.'});
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0].trim()||'unknown';if(limited(ip))return res.status(429).json({error:'Too many requests. Wait a minute.'});
  let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body);}catch(e){body=null;}}
  const msgs=Array.isArray(body&&body.messages)?body.messages.slice(-12):[];if(!msgs.length)return res.status(400).json({error:'No message.'});
  const known=body&&typeof body.known==='object'?body.known:{};
  const chat=[{role:'system',content:SYSTEM},{role:'system',content:'Already known (JSON): '+JSON.stringify(known).slice(0,2000)}]
    .concat(msgs.map(m=>({role:m.role==='ai'?'assistant':'user',content:String(m.text||'').slice(0,1500)})));
  try{const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:process.env.ONBOARD_MODEL||'gpt-4o-mini',temperature:0.4,messages:chat,response_format:{type:'json_schema',json_schema:{name:'onboarding_turn',strict:true,schema}}})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status===429?429:502).json({error:(j.error&&j.error.message)||('OpenAI error '+r.status)});
    let out;try{out=JSON.parse(j.choices[0].message.content);}catch(e){return res.status(502).json({error:'AI response could not be read.'});}
    return res.status(200).json(out);
  }catch(e){return res.status(502).json({error:'Could not reach the AI service.'});}
};
