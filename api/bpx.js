const { createClient } = require('@libsql/client');
const crypto = require('crypto');

// Turso database connection configuration
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper function to set CORS headers
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method === 'POST') {
        // ... (POST logic remains the same as your previous bpx.js)
        const { data } = req.body;
        const url = data ? data.u : null;
        const referrer = data ? data.r : null;

        if (!url) {
            return res.status(400).json({ message: 'URL is required.' });
        }

        let domain;
        try {
            domain = new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return res.status(400).json({ message: 'Invalid URL format.' });
        }

        const checkResult = await client.execute({
            sql: "SELECT 1 FROM allowed_domains WHERE domain = ?",
            args: [domain],
        });

        if (checkResult.rows.length === 0) {
            return res.status(403).json({ message: `Domain '${domain}' is not tracked.` });
        }

        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';
        const today = new Date().toISOString().split('T')[0];

        const browser = userAgent.match(/(firefox|chrome|safari|edg|opera)/i)?.[0] || 'Unknown';
        const device_type = userAgent.match(/mobile/i) ? 'mobile' : 'desktop';

        let isUnique = false;
        const hashInput = `${ip}-${userAgent}-${today}-${url}`;
        const visitorHash = crypto.createHash('sha256').update(hashInput).digest('hex');

        if (ip && userAgent) {
            try {
                await client.execute({
                    sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                    args: [visitorHash, today],
                });
                isUnique = true;
            } catch (error) {
                if (!error.message.includes('UNIQUE constraint failed')) {
                    console.error("Error inserting visitor hash:", error);
                }
            }
        }

        await client.execute({
            sql: `INSERT INTO analytics_timeseries 
                    (url, domain, is_unique, referrer, browser, device_type, ip_address, visitor_hash) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [url, domain, isUnique, referrer, browser, device_type, ip, visitorHash],
        });

        await client.execute({
            sql: `
                INSERT INTO page_views (url, domain, views, unique_views) VALUES (?, ?, 1, ?)
                ON CONFLICT(url) DO UPDATE SET
                    views = views + 1,
                    unique_views = unique_views + ?;
            `,
            args: [url, domain, isUnique ? 1 : 0, isUnique ? 1 : 0],
        });

        return res.status(200).json({ message: 'View tracked.' });
    }
    
    if (req.method === 'GET') {
        try {
            const { view, url: urlParam, period = '7d' } = req.query;

            // Handle detailed log view (unaffected by period)
            if (view === 'details' && urlParam) {
                 const logData = await client.execute({
                    sql: `SELECT timestamp, referrer, browser, device_type, ip_address
                          FROM analytics_timeseries
                          WHERE url = ?
                          ORDER BY timestamp DESC
                          LIMIT 50`,
                    args: [decodeURIComponent(urlParam)]
                });
                return res.status(200).json(logData.rows);
            }

            // --- Main Dashboard Data Fetching ---
            const periodMap = { '1d': '-1 days', '7d': '-7 days', '30d': '-30 days', '90d': '-90 days' };
            const interval = periodMap[period] || '-7 days';

            // Base SQL for stats calculation
            let statsSql = `
                WITH sessions AS (
                    SELECT
                        visitor_hash,
                        COUNT(id) AS page_views_per_session,
                        CAST(strftime('%s', MAX(timestamp)) - strftime('%s', MIN(timestamp)) AS INTEGER) AS session_duration_seconds
                    FROM analytics_timeseries
                    WHERE timestamp >= datetime('now', ?)
                    GROUP BY visitor_hash
                )
                SELECT
                    (SELECT COUNT(*) FROM analytics_timeseries WHERE timestamp >= datetime('now', ?)) as total_page_views,
                    (SELECT COUNT(DISTINCT visitor_hash) FROM analytics_timeseries WHERE timestamp >= datetime('now', ?)) as total_unique_visitors,
                    COUNT(*) AS total_sessions,
                    SUM(CASE WHEN page_views_per_session = 1 THEN 1 ELSE 0 END) AS total_bounces,
                    SUM(session_duration_seconds) AS total_duration_seconds
                FROM sessions;
            `;
            
            // Get all summary data at once
            const summaryResult = await client.execute("SELECT url, domain, views, unique_views FROM page_views");
            const summaryByDomain = summaryResult.rows.reduce((acc, row) => {
                const { domain, url, views, unique_views } = row;
                if (!acc[domain]) acc[domain] = [];
                acc[domain].push({ url, views, unique_views });
                return acc;
            }, {});
            
             // Fetch stats (Bounce Rate, Avg Session etc.)
            const statsResult = await client.execute({
                sql: statsSql,
                args: [interval, interval, interval]
            });

            const stats = statsResult.rows[0] || {};
            const { total_sessions = 0, total_bounces = 0, total_duration_seconds = 0, total_page_views = 0, total_unique_visitors = 0 } = stats;

            const bounceRate = total_sessions > 0 ? (total_bounces / total_sessions) * 100 : 0;
            const avgSessionSeconds = total_sessions > 0 ? total_duration_seconds / total_sessions : 0;
            
            return res.status(200).json({
                summary: summaryByDomain,
                overview: {
                    pageViews: total_page_views,
                    uniqueVisitors: total_unique_visitors,
                    bounceRate: parseFloat(bounceRate.toFixed(1)),
                    avgSessionSeconds: Math.round(avgSessionSeconds)
                }
            });

        } catch (error) {
            console.error('Error fetching analytics data:', error);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
};

