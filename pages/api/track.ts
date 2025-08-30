import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../lib/db';
import { parseUserAgent, getClientIP } from '../../lib/utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Allow CORS for tracking script
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get client information
    const ip = getClientIP(req as any) || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referrer = req.headers.referer || req.body?.referrer || null;
    
    // Parse user agent
    const { browser, device } = parseUserAgent(userAgent);

    // Insert into database
    await db.execute({
      sql: `INSERT INTO pizzle (ip, user_agent, referrer, browser, device) 
            VALUES (?, ?, ?, ?, ?)`,
      args: [ip, userAgent, referrer, browser, device]
    });

    // Return a 1x1 transparent pixel for GET requests (tracking pixel)
    if (req.method === 'GET') {
      const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Content-Length', pixel.length);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(pixel);
    }

    // JSON response for POST requests
    res.status(200).json({ success: true, tracked: true });
  } catch (error) {
    console.error('Tracking error:', error);
    res.status(500).json({ error: 'Failed to track visit' });
  }
}