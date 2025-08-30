import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../lib/db';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { days = '7' } = req.query;
    const daysCount = parseInt(days as string);

    // Get total visits
    const totalVisits = await db.execute({
      sql: `SELECT COUNT(*) as count FROM pizzle 
            WHERE created_at >= datetime('now', '-${daysCount} days')`,
      args: []
    });

    // Get top browsers
    const topBrowsers = await db.execute({
      sql: `SELECT browser, COUNT(*) as count FROM pizzle 
            WHERE created_at >= datetime('now', '-${daysCount} days')
            GROUP BY browser 
            ORDER BY count DESC 
            LIMIT 10`,
      args: []
    });

    // Get top referrers
    const topReferrers = await db.execute({
      sql: `SELECT 
              CASE 
                WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
                ELSE referrer 
              END as referrer,
              COUNT(*) as count 
            FROM pizzle 
            WHERE created_at >= datetime('now', '-${daysCount} days')
            GROUP BY referrer 
            ORDER BY count DESC 
            LIMIT 10`,
      args: []
    });

    // Get top devices
    const topDevices = await db.execute({
      sql: `SELECT device, COUNT(*) as count FROM pizzle 
            WHERE created_at >= datetime('now', '-${daysCount} days')
            GROUP BY device 
            ORDER BY count DESC 
            LIMIT 10`,
      args: []
    });

    // Get daily visits for the chart
    const dailyVisits = await db.execute({
      sql: `SELECT 
              DATE(created_at) as date, 
              COUNT(*) as count 
            FROM pizzle 
            WHERE created_at >= datetime('now', '-${daysCount} days')
            GROUP BY DATE(created_at) 
            ORDER BY date`,
      args: []
    });

    const analytics = {
      totalVisits: totalVisits.rows[0].count,
      topBrowsers: topBrowsers.rows,
      topReferrers: topReferrers.rows,
      topDevices: topDevices.rows,
      dailyVisits: dailyVisits.rows,
      period: `${daysCount} days`
    };

    res.status(200).json(analytics);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
}