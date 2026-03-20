const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { url } = JSON.parse(event.body || '{}');
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };

  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  try {
    const isPost = url.includes('/reel/') || url.includes('/p/') || url.includes('/tv/');
    let username = '';

    if (!isPost) {
      username = url.replace(/\/$/, '').split('/').filter(Boolean).pop();
      if (username.startsWith('@')) username = username.slice(1);
    }

    const input = isPost
      ? { directUrls: [url], resultsType: 'posts', resultsLimit: 1 }
      : { username: [username], resultsLimit: 10 };

    const actor = isPost ? 'apify~instagram-scraper' : 'apify~instagram-post-scraper';

    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }
    );

    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.error?.message || 'Apify start failed' }) };
    }

    const run = await startRes.json();
    const runId = run.data.id;
    const dsId = run.data.defaultDatasetId;

    let done = false, attempts = 0;
    while (!done && attempts < 40) {
      await new Promise(r => setTimeout(r, 4000));
      const poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
      const pd = await poll.json();
      const status = pd.data.status;
      if (status === 'SUCCEEDED') { done = true; break; }
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Scraper failed — account may be private' }) };
      }
      attempts++;
    }

    if (!done) return { statusCode: 504, headers, body: JSON.stringify({ error: 'Timed out — try again' }) };

    const dsRes = await fetch(
      `https://api.apify.com/v2/datasets/${dsId}/items?token=${APIFY_TOKEN}&limit=10`
    );
    const items = await dsRes.json();

    const posts = (Array.isArray(items) ? items : [])
      .filter(r => r.caption || r.text)
      .map(r => ({
        caption: r.caption || r.text || '',
        likes: r.likesCount || 0,
        comments: r.commentsCount || 0,
        url: r.url || ''
      }));

    if (!posts.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No captions found — account may be private' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ posts }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
