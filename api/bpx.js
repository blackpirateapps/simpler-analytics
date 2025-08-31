const { createClient } = require('@libsql/client');
const crypto = require('crypto');

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { return res.status(204).end(); }

    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof req.body === 'string') {
                try { body = JSON.parse(req.body); } catch (e) {
                    return res.status(400).json({ message: 'Invalid JSON payload.' });
                }
            }
            const { data, type = 'pageview' } = body;

            // Handle active time duration updates
            if (type === 'duration') {
                const { u: url, duration } = data;
                if (!url || typeof duration !== 'number' || duration < 0) {
                    return res.status(400).json({ message: 'URL and a valid duration are required.' });
                }
                await client.execute({
                    sql: "UPDATE page_views SET total_active_seconds = total_active_seconds + ? WHERE url = ?",
                    args: [Math.round(duration), url]
                });
                return res.status(200).json({ message: 'Duration tracked.' });
            }

            // Handle initial pageview
            const { u: url, r: referrer } = data;
            if (!url) { return res.status(400).json({ message: 'URL is required.' }); }

            let domain;
            try { domain = new URL(url).hostname.replace(/^www\./, ''); } 
            catch (error) { return res.status(400).json({ message: 'Invalid URL format.' }); }

            const checkResult = await client.execute({
                sql: "SELECT 1 FROM allowed_domains WHERE domain = ?", args: [domain],
            });
            if (checkResult.rows.length === 0) {
                return res.status(403).json({ message: `Domain '${domain}' is not tracked.` });
            }

            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const country = req.headers['x-vercel-ip-country'] || 'Unknown';
            const userAgent = req.headers['user-agent'] || '';
            const today = new Date().toISOString().split('T')[0];
            const browser = userAgent.match(/(firefox|chrome|safari|edg|opera)/i)?.[0] || 'Unknown';
            const device_type = userAgent.match(/mobile/i) ? 'mobile' : 'desktop';
            const hashInput = `${ip}-${userAgent}-${today}-${url}`;
            const visitorHash = crypto.createHash('sha256').update(hashInput).digest('hex');
            let isUnique = false;

            try {
                await client.execute({
                    sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)", args: [visitorHash, today],
                });
                isUnique = true;
            } catch (error) {
                if (!error.message.includes('UNIQUE constraint failed')) { console.error("Error inserting visitor hash:", error); }
            }

            await client.execute({
                sql: `INSERT INTO analytics_timeseries (url, domain, is_unique, referrer, browser, device_type, ip_address, visitor_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [url, domain, isUnique, referrer, browser, device_type, ip, visitorHash, country],
            });
            await client.execute({
                sql: `INSERT INTO page_views (url, domain, views, unique_views) VALUES (?, ?, 1, ?) ON CONFLICT(url) DO UPDATE SET views = views + 1, unique_views = unique_views + ?;`,
                args: [url, domain, isUnique ? 1 : 0, isUnique ? 1 : 0],
            });
            return res.status(200).json({ message: 'View tracked.' });

        } catch (error) {
            console.error('Error in POST /api/bpx:', error);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    }
    
    if (req.method === 'GET') {
        try {
            const { view, url: urlParam, period = '7d', admin_key } = req.query;

            if (view === 'details' && urlParam) {
                const isAdmin = process.env.ADMIN_PASSWORD && admin_key === process.env.ADMIN_PASSWORD;
                const fields = isAdmin ? `timestamp, referrer, browser, device_type, country, ip_address` : `timestamp, referrer, browser, device_type, country`;
                const logData = await client.execute({
                    sql: `SELECT ${fields} FROM analytics_timeseries WHERE url = ? ORDER BY timestamp DESC LIMIT 50`,
                    args: [decodeURIComponent(urlParam)]
                });
                return res.status(200).json(logData.rows);
            }

            const periodMap = { '1d': '-1 days', '7d': '-7 days', '30d': '-30 days', '90d': '-90 days' };
            const interval = periodMap[period] || '-7 days';
            
            const summaryResult = await client.execute("SELECT url, domain, views, unique_views, total_active_seconds FROM page_views");
            
            let totalSiteViews = 0;
            let totalSiteActiveSeconds = 0;
            const summaryByDomain = summaryResult.rows.reduce((acc, row) => {
                const { domain, url, views, unique_views, total_active_seconds } = row;
                if (!acc[domain]) acc[domain] = [];
                acc[domain].push({ url, views, unique_views, total_active_seconds });
                totalSiteViews += views;
                totalSiteActiveSeconds += (total_active_seconds || 0);
                return acc;
            }, {});

            const avgSiteActiveTimeSeconds = totalSiteViews > 0 ? totalSiteActiveSeconds / totalSiteViews : 0;
            
            // Note: Bounce Rate and Session stats are less accurate now, but kept for context.
            // Active time per page is the primary metric.
            const statsResult = await client.execute({
                sql: `WITH sessions AS (SELECT visitor_hash, COUNT(id) as views FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) GROUP BY visitor_hash) SELECT COUNT(*) as total_sessions, SUM(CASE WHEN views = 1 THEN 1 ELSE 0 END) as bounces FROM sessions;`,
                args: [interval]
            });
            const { total_sessions = 0, bounces = 0 } = statsResult.rows[0] || {};
            const bounceRate = total_sessions > 0 ? (bounces / total_sessions) * 100 : 0;
            
            return res.status(200).json({
                summary: summaryByDomain,
                overview: {
                    bounceRate: parseFloat(bounceRate.toFixed(1)),
                    avgSiteActiveTimeSeconds: Math.round(avgSiteActiveTimeSeconds),
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

