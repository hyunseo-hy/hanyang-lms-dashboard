export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  const sessionCookie = req.headers['x-lms-cookie'] || '';
  if (!sessionCookie) return res.status(401).json({ error: 'x-lms-cookie header required' });

  const url = 'https://learning.hanyang.ac.kr' + decodeURIComponent(endpoint);
  try {
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': sessionCookie,
      },
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
