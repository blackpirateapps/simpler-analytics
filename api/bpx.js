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

    try {
        if (req.method === 'POST') {
            const { type, data } = req.body;
            const url = data ? data.u : null;
            if (!url) return res.status(400).json({ message: 'URL (u) is required.' });

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
            
            if (type === 'pageview') {
                const referrer = data ? data.r : null;
                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                const userAgent = req.headers['user-agent'];
                const country = req.headers['x-vercel-ip-country'] || 'Unknown';
                const today = new Date().toISOString().split('T')[0];
                
                const browser = userAgent.match(/(firefox|chrome|safari|edg|opera)/i)?.[0] || 'Unknown';
                const device_type = userAgent.match(/mobile/i) ? 'mobile' : 'desktop';

                let isUnique = false;
                const hashInput = `${ip}-${userAgent}-${today}`;
                const visitorHash = crypto.createHash('sha256').update(hashInput).digest('hex');

                if (ip && userAgent) {
                    try {
                        await client.execute({
                            sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                            args: [visitorHash, today],
                        });
                        isUnique = true;
                    } catch (error) {
                        if (!error.message.includes('UNIQUE constraint failed')) { throw error; }
                    }
                }

                await client.execute({
                    sql: `INSERT INTO analytics_timeseries (url, domain, is_unique, referrer, browser, device_type, ip_address, visitor_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [url, domain, isUnique, referrer, browser, device_type, ip, visitorHash, country],
                });

                await client.execute({
                    sql: `INSERT INTO page_views (url, domain, views, unique_views) VALUES (?, ?, 1, ?) ON CONFLICT(url) DO UPDATE SET views = views + 1, unique_views = unique_views + ?;`,
                    args: [url, domain, isUnique ? 1 : 0, isUnique ? 1 : 0],
                });
                
                return res.status(202).json({ message: 'Pageview tracked.' });

            } else if (type === 'duration') {
                const duration = data ? data.d : null;
                if (typeof duration !== 'number' || duration <= 0) {
                    return res.status(400).json({ message: 'Duration (d) is required and must be a positive number.' });
                }
                
                await client.execute({
                    sql: "UPDATE page_views SET total_active_seconds = total_active_seconds + ? WHERE url = ?",
                    args: [Math.round(duration), url]
                });

                return res.status(202).json({ message: 'Duration updated.' });
            } else {
                return res.status(400).json({ message: 'Invalid event type.' });
            }

        } else if (req.method === 'GET') {
            const { view, url: urlParam, period = '7d', domain: domainParam, admin_key } = req.query;

            if (view === 'details') {
                if (!urlParam) return res.status(400).json({ message: 'URL parameter is required for details view.' });
                
                const showIp = admin_key === process.env.ADMIN_PASSWORD;
                const columns = `timestamp, country, ${showIp ? 'ip_address,' : ''} browser, device_type, referrer`;

                const logData = await client.execute({
                    sql: `SELECT ${columns} FROM analytics_timeseries WHERE url = ? ORDER BY timestamp DESC LIMIT 50`,
                    args: [urlParam]
                });

                return res.status(200).json(logData.rows);
            }
            
            const intervalMap = { '1d': '-24 hours', '7d': '-7 days', '30d': '-30 days', '90d': '-90 days' };
            const interval = intervalMap[period] || '-7 days';
            
            const domainFilter = domainParam && domainParam !== 'all' ? `AND domain = ?` : '';
            const queryArgs = [interval];
            if (domainFilter) queryArgs.push(domainParam);

            // --- REFACTORED QUERIES for performance and correctness ---

            // More efficient query that scans the timeseries table only once.
            const overviewSql = `
                WITH period_data AS (
                    SELECT visitor_hash, timestamp, url
                    FROM analytics_timeseries
                    WHERE timestamp >= datetime('now', ?) ${domainFilter}
                ),
                sessions AS (
                    SELECT
                        visitor_hash,
                        COUNT(url) as page_count,
                        CAST(strftime('%s', MAX(timestamp)) - strftime('%s', MIN(timestamp)) AS INTEGER) AS session_duration_seconds
                    FROM period_data
                    GROUP BY visitor_hash
                )
                SELECT
                    (SELECT COUNT(*) FROM sessions) AS total_sessions,
                    (SELECT SUM(CASE WHEN page_count = 1 THEN 1 ELSE 0 END) FROM sessions) AS bounce_count,
                    (SELECT SUM(session_duration_seconds) FROM sessions) AS total_duration_seconds,
                    (SELECT COUNT(*) FROM period_data) as total_page_views,
                    (SELECT COUNT(DISTINCT visitor_hash) FROM period_data) as total_unique_visitors;
            `;
            
            const overviewResult = await client.execute({ sql: overviewSql, args: queryArgs });
            const stats = overviewResult.rows[0] || {};
            
            // Handle cases where SUM returns NULL on empty sets by defaulting to 0
            const totalSessions = stats.total_sessions || 0;
            const bounceCount = stats.bounce_count || 0;
            const totalDurationSeconds = stats.total_duration_seconds || 0;

            const bounceRate = totalSessions > 0 ? Math.round((bounceCount / totalSessions) * 100) : 0;
            const avgSessionSeconds = totalSessions > 0 ? Math.round(totalDurationSeconds / totalSessions) : 0;
            
            // This query now correctly calculates top pages for the given period.
            const topPagesSql = `
                SELECT
                    ats.url,
                    COUNT(*) AS views,
                    COUNT(DISTINCT ats.visitor_hash) AS unique_views,
                    pv.total_active_seconds
                FROM analytics_timeseries AS ats
                LEFT JOIN page_views AS pv ON ats.url = pv.url
                WHERE ats.timestamp >= datetime('now', ?) ${domainFilter}
                GROUP BY ats.url
                ORDER BY views DESC
                LIMIT 10;
            `;
            const topPagesResult = await client.execute({ sql: topPagesSql, args: queryArgs });
            
            const totalSiteActiveSecondsResult = await client.execute({
                sql: `
                    SELECT SUM(total_active_seconds) as total 
                    FROM page_views 
                    WHERE url IN (SELECT url FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) ${domainFilter} GROUP BY url)
                `,
                args: queryArgs
            });
            const totalSiteActiveSeconds = totalSiteActiveSecondsResult.rows[0]?.total || 0;
            const totalPageViews = stats.total_page_views || 0;
            const avgSiteActiveTimeSeconds = totalPageViews > 0 ? totalSiteActiveSeconds / totalPageViews : 0;

            return res.status(200).json({
                overview: {
                    pageViews: totalPageViews,
                    uniqueVisitors: stats.total_unique_visitors || 0,
                    bounceRate: bounceRate,
                    avgSessionSeconds: avgSessionSeconds,
                    avgSiteActiveTimeSeconds: avgSiteActiveTimeSeconds,
                },
                topPages: topPagesResult.rows
            });

        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('A critical error occurred in the bpx function:', error);
        return res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
}

