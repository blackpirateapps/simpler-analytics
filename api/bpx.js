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
            // FIX: Safely parse the request body, as it might be a string in some environments.
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } 
                catch { return res.status(400).json({ message: 'Invalid JSON body.' }); }
            }
            const { type, data } = body || {};

            const url = data ? data.u : null;
            if (!url) return res.status(400).json({ message: 'URL (u) is required.' });

            let domain;
            try { domain = new URL(url).hostname.replace(/^www\./, ''); } 
            catch (error) { return res.status(400).json({ message: 'Invalid URL format.' }); }

            const checkResult = await client.execute({ sql: "SELECT 1 FROM allowed_domains WHERE domain = ?", args: [domain] });
            if (checkResult.rows.length === 0) { return res.status(403).json({ message: `Domain '${domain}' is not tracked.` }); }
            
            if (type === 'pageview') {
                const referrer = data ? data.r : null;
                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                const userAgent = req.headers['user-agent'] || 'Unknown';
                const country = req.headers['x-vercel-ip-country'] || 'Unknown';
                const today = new Date().toISOString().split('T')[0];
                const browser = userAgent.match(/(firefox|chrome|safari|edg|opera)/i)?.[0] || 'Unknown';
                const device_type = userAgent.match(/mobile/i) ? 'mobile' : 'desktop';
                const visitorHash = crypto.createHash('sha256').update(`${ip}-${userAgent}-${today}`).digest('hex');

                let isUnique = false;
                try {
                    await client.execute({ sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)", args: [visitorHash, today] });
                    isUnique = true;
                } catch (error) { if (!error.message.includes('UNIQUE constraint failed')) { throw error; } }

                await client.execute({
                    sql: `INSERT INTO analytics_timeseries (url, domain, is_unique, referrer, browser, device_type, ip_address, visitor_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [url, domain, isUnique, referrer, browser, device_type, ip, visitorHash, country],
                });

                // FIX: Correctly include all required columns in the INSERT statement.
                await client.execute({
                    sql: `INSERT INTO page_views (url, domain, views, unique_views, total_active_seconds) VALUES (?, ?, 1, ?, 0) ON CONFLICT(url) DO UPDATE SET views = views + 1, unique_views = unique_views + ?;`,
                    args: [url, domain, isUnique ? 1 : 0, isUnique ? 1 : 0],
                });
                return res.status(202).json({ message: 'Pageview tracked.' });

            } else if (type === 'duration') {
                const duration = data ? data.d : null;
                if (typeof duration !== 'number' || duration <= 0) { return res.status(400).json({ message: 'Duration (d) is required.' }); }
                await client.execute({ sql: "UPDATE page_views SET total_active_seconds = total_active_seconds + ? WHERE url = ?", args: [Math.round(duration), url] });
                return res.status(202).json({ message: 'Duration updated.' });
            } else {
                return res.status(400).json({ message: 'Invalid event type.' });
            }

        } else if (req.method === 'GET') {
            const { view, url: urlParam, period = 'all_time', domain: domainParam, admin_key } = req.query;

            if (view === 'details') {
                if (!urlParam) return res.status(400).json({ message: 'URL parameter is required.' });
                const showIp = admin_key === process.env.ADMIN_PASSWORD;
                const columns = `timestamp, country, ${showIp ? 'ip_address,' : ''} browser, device_type, referrer`;
                const logData = await client.execute({ sql: `SELECT ${columns} FROM analytics_timeseries WHERE url = ? ORDER BY timestamp DESC LIMIT 50`, args: [urlParam] });
                return res.status(200).json(logData.rows);
            }

            let overview, topPages;
            const domainFilter = domainParam && domainParam !== 'all' ? `AND domain = ?` : '';
            const domainFilterWhere = domainParam && domainParam !== 'all' ? `WHERE domain = ?` : '';

            if (period === 'all_time') {
                const queryArgs = domainParam && domainParam !== 'all' ? [domainParam] : [];
                const allTimePagesSql = `SELECT url, views, unique_views, total_active_seconds FROM page_views ${domainFilterWhere} ORDER BY views DESC;`;
                const allTimePagesResult = await client.execute({ sql: allTimePagesSql, args: queryArgs });
                topPages = allTimePagesResult.rows;

                const pageViews = topPages.reduce((sum, page) => sum + page.views, 0);
                const uniqueVisitors = topPages.reduce((sum, page) => sum + page.unique_views, 0);
                const totalActiveSeconds = topPages.reduce((sum, page) => sum + (page.total_active_seconds || 0), 0);
                const avgSiteActiveTimeSeconds = pageViews > 0 ? totalActiveSeconds / pageViews : 0;

                overview = {
                    pageViews,
                    uniqueVisitors,
                    bounceRate: 0,
                    avgSiteActiveTimeSeconds,
                };
            } else {
                const intervalMap = { '1d': '-24 hours', '7d': '-7 days', '30d': '-30 days', '90d': '-90 days' };
                const interval = intervalMap[period];
                if (!interval) return res.status(400).json({ message: 'Invalid period specified.' });

                const queryArgs = [interval];
                if (domainParam && domainParam !== 'all') queryArgs.push(domainParam);

                const realTimePagesSql = `
                    SELECT
                        ats.url,
                        COUNT(*) AS views,
                        COUNT(DISTINCT ats.visitor_hash) AS unique_views,
                        pv.total_active_seconds
                    FROM analytics_timeseries AS ats
                    LEFT JOIN page_views AS pv ON ats.url = pv.url
                    WHERE ats.timestamp >= datetime('now', ?) ${domainFilter}
                    GROUP BY ats.url
                    ORDER BY views DESC;
                `;
                const realTimePagesResult = await client.execute({ sql: realTimePagesSql, args: queryArgs });
                topPages = realTimePagesResult.rows;

                const pageViews = topPages.reduce((sum, page) => sum + page.views, 0);
                const uniqueVisitors = topPages.reduce((sum, page) => sum + page.unique_views, 0);
                const totalActiveSeconds = topPages.reduce((sum, page) => sum + (page.total_active_seconds || 0), 0);
                const avgSiteActiveTimeSeconds = pageViews > 0 ? totalActiveSeconds / pageViews : 0;

                const sessionSql = `
                    WITH sessions AS (
                        SELECT visitor_hash, COUNT(url) as page_count
                        FROM analytics_timeseries WHERE timestamp >= datetime('now', ?) ${domainFilter}
                        GROUP BY visitor_hash
                    )
                    SELECT COUNT(*) AS total_sessions, SUM(CASE WHEN page_count = 1 THEN 1 ELSE 0 END) AS bounce_count
                    FROM sessions;
                `;
                const sessionResult = await client.execute({ sql: sessionSql, args: queryArgs });
                const sessionStats = sessionResult.rows[0] || {};
                const totalSessions = sessionStats.total_sessions || 0;
                const bounceCount = sessionStats.bounce_count || 0;
                const bounceRate = totalSessions > 0 ? Math.round((bounceCount / totalSessions) * 100) : 0;

                overview = {
                    pageViews,
                    uniqueVisitors,
                    bounceRate,
                    avgSiteActiveTimeSeconds,
                };
            }

            return res.status(200).json({
                overview,
                topPages: topPages.slice(0, 10)
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

