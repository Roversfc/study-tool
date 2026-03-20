const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { prompt } = JSON.parse(event.body || '{}');
    if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No prompt' }) };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    console.log('Anthropic response status:', res.status);
    console.log('Anthropic response:', JSON.stringify(data).slice(0, 200));
    
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.log('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
