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
      system: `You are a warm, knowledgeable personal health coach. Generate a concise morning health briefing based on Apple Health data.

Structure your response exactly like this:
STATUS: [one of: Great day / Good day / Rest day / Data incomplete]
HIGHLIGHTS: [2-3 bullet points starting with -]
TODAY: [one actionable suggestion for today]
WATCH: [one pattern to note, or "Nothing flagged"]

Be conversational and specific to the numbers. Under 200 words total.`,
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
      calories: w.activeEnergyBurned || w.calories
    }));
  }

  return JSON.stringify(summary, null, 2);
}
