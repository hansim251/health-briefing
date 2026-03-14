export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Missing API key.' });

  const { messages, healthSummary } = req.body;
  if (!messages) return res.status(400).json({ error: 'No messages provided.' });

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
      system: `You are a warm, knowledgeable personal health coach. The user is asking questions about their Apple Health data.

Here is their health summary for today:
${healthSummary || 'No health data available.'}

Answer their questions conversationally, be specific to their numbers, and give practical advice. Keep responses concise.`,
      messages
    })
  });

  const data = await claude.json();
  const reply = data.content?.find(b => b.type === 'text')?.text;
  if (!reply) return res.status(500).json({ error: 'No response from Claude.', debug: data });

  return res.status(200).json({ reply });
}
