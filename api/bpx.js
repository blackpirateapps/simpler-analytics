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

            const overviewSql = `
                WITH sessions AS (
                    SELECT
                        visitor_hash,
                        COUNT(url) as page_count,
                        CAST(strftime('%s', MAX(timestamp)) - strftime('%s', MIN(timestamp)) AS INTEGER) AS session_duration_seconds
                    FROM analytics_timeseries
                    WHERE timestamp >= datetime('now', ?) ${domainFilter}
                    GROUP BY visitor_hash
                )
                SELECT
                    COUNT(*) AS total_sessions,
                    SUM(CASE WHEN page_count = 1 THEN 1 ELSE 0 END) AS bounce_count,
                    SUM(session_duration_seconds) AS total_duration_seconds,
                    (SELECT COUNT(*) FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) ${domainFilter}) as total_page_views,
                    (SELECT COUNT(DISTINCT visitor_hash) FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) ${domainFilter}) as total_unique_visitors
                FROM sessions;
            `;

            const overviewResult = await client.execute({
                sql: overviewSql,
                args: [...queryArgs, ...queryArgs, ...queryArgs],
            });
            const stats = overviewResult.rows[0] || {};
            const bounceRate = stats.total_sessions > 0 ? Math.round((stats.bounce_count / stats.total_sessions) * 100) : 0;
            const avgSessionSeconds = stats.total_sessions > 0 ? Math.round(stats.total_duration_seconds / stats.total_sessions) : 0;

            const topPagesSql = `
                SELECT url, views, unique_views, total_active_seconds
                FROM page_views
                WHERE domain IN (SELECT domain FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) ${domainFilter} GROUP BY domain)
                ORDER BY views DESC
                LIMIT 10;
            `;
            
            const topPagesResult = await client.execute({
                sql: topPagesSql,
                args: queryArgs,
            });
            
            const totalSiteActiveSeconds = (await client.execute({
                sql: `SELECT SUM(total_active_seconds) as total FROM page_views WHERE domain IN (SELECT domain FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) ${domainFilter} GROUP BY domain)`,
                args: queryArgs
            })).rows[0]?.total || 0;

            const avgSiteActiveTimeSeconds = stats.total_page_views > 0 ? totalSiteActiveSeconds / stats.total_page_views : 0;

            return res.status(200).json({
                overview: {
                    pageViews: stats.total_page_views || 0,
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

