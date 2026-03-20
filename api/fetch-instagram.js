export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  try {
    const isPost = url.includes('/reel/') || url.includes('/p/') || url.includes('/tv/');
    let username = '';

    if (!isPost) {
      username = url.replace(/\/$/, '').split('/').filter(Boolean).pop();
      if (username.startsWith('@')) username = username.slice(1);
    }

    // Start Apify run
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
      return res.status(500).json({ error: err.error?.message || 'Apify start failed' });
    }

    const run = await startRes.json();
    const runId = run.data.id;
    const dsId = run.data.defaultDatasetId;

    // Poll until done
    let done = false, attempts = 0;
    while (!done && attempts < 40) {
      await new Promise(r => setTimeout(r, 4000));
      const poll = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`
      );
      const pd = await poll.json();
      const status = pd.data.status;
      if (status === 'SUCCEEDED') { done = true; break; }
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        return res.status(500).json({ error: 'Scraper failed — account may be private' });
      }
      attempts++;
    }

    if (!done) return res.status(504).json({ error: 'Timed out — try again' });

    // Get results
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
      return res.status(404).json({ error: 'No captions found — account may be private or caption-free' });
    }

    return res.status(200).json({ posts });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
