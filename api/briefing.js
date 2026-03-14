export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Missing environment variables.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let record = null;
  for (const date of [today, yesterday]) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/health_data?recorded_date=eq.${date}&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!r.ok) return res.status(500).json({ error: `Supabase error: ${r.status}` });
    const rows = await r.json();
    if (rows.length) { record = rows[0]; break; }
  }

  if (!record) return res.status(404).json({ error: 'No health data found.' });

  const summary = summarisePayload(record.payload);

  const claude = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a knowledgeable personal health coach analysing Apple Health data. Generate a detailed morning briefing.

Structure your response exactly like this:

STATUS: [one of: Great day / Good day / Rest day / Data incomplete]

OVERVIEW: [2-3 sentences summarising the day overall — how the body performed, energy output, recovery]

ACTIVITY: [detailed bullet points covering any workouts or activity — include pace per km/mile, split segments if available, distance, duration, calories burned, and how effort compared to typical sessions]

HEART: [detailed bullet points on heart rate data — resting HR, average HR during activity, peak HR, HRV score and what it indicates about recovery, any notable patterns]

SLEEP: [detailed bullet points on sleep — total duration, time in each stage (deep/REM/light/awake) if available, sleep score or efficiency, and how it likely affects today's energy]

Be specific and analytical. Use actual numbers from the data. If a section has no data, omit it entirely. No generic advice.`,
      messages: [{ role: 'user', content: `Health data for ${record.recorded_date}:\n\n${summary}` }]
    })
  });

  const claudeData = await claude.json();
  const briefing = claudeData.content?.find(b => b.type === 'text')?.text;
  if (!briefing) return res.status(500).json({ error: 'Claude did not return a briefing.', debug: claudeData });

  return res.status(200).json({ briefing, date: record.recorded_date, payload: record.payload });
}

function summarisePayload(payload) {
  const data = payload.data || payload;
  const arr = data.metrics || data.Metrics || [];
  const summary = {};

  arr.forEach(item => {
    const name = item.name || item.Name || '';
    const vals = item.data || item.Data || [];
    if (!vals.length) return;
    const last = vals[vals.length - 1];
    const qty = last ? (last.qty ?? last.value ?? last.Qty) : null;
    if (qty != null) summary[name] = qty;
  });

  const workouts = data.workouts || data.Workouts || [];
  if (workouts.length) {
    summary['workouts'] = workouts.slice(-3).map(w => ({
      type: w.name || w.workoutActivityType || 'Workout',
      duration: w.duration,
      distance: w.totalDistance,
      calories: w.activeEnergyBurned || w.calories,
      avgHeartRate: w.averageHeartRate,
      maxHeartRate: w.maxHeartRate,
      segments: w.segments || w.splits || null
    }));
  }

  return JSON.stringify(summary, null, 2);
}
