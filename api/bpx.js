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
            const { data } = req.body;
            const url = data ? data.u : null;
            if (!url) return res.status(400).json({ message: 'URL is required.' });

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

            // --- MODIFIED: Unique Visitor Logic ---
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

            // Generate a persistent visitor ID for accurate unique tracking
            const visitor_id = ip && userAgent ? crypto.createHash('sha256').update(`${ip}-${userAgent}`).digest('hex') : null;

            let isUniqueToday = false;
            // This part is for the daily unique check, which you might still want for some summaries
            if (ip && userAgent) {
                const dailyHashInput = `${ip}-${userAgent}-${today}-${url}`;
                const dailyVisitorHash = crypto.createHash('sha256').update(dailyHashInput).digest('hex');
                try {
                    await client.execute({
                        sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                        args: [dailyVisitorHash, today],
                    });
                    isUniqueToday = true;
                } catch (error) {
                    if (!error.message.includes('UNIQUE constraint failed')) {
                        console.error("[Analytics Debug] ERROR: An unexpected database error occurred while checking uniqueness.", error);
                        throw error;
                    }
                }
            }
            
            // --- MODIFIED: Update Database with visitor_id ---
            await client.execute({
                sql: "INSERT INTO analytics_timeseries (url, domain, is_unique, visitor_id) VALUES (?, ?, ?, ?)",
                args: [url, new URL(url).hostname, isUniqueToday, visitor_id],
            });

            await client.execute({
                sql: `
                    INSERT INTO page_views (url, domain, views, unique_views) VALUES (?, ?, 1, ?)
                    ON CONFLICT(url) DO UPDATE SET
                        views = views + 1,
                        unique_views = unique_views + ?;
                `,
                args: [url, new URL(url).hostname, isUniqueToday ? 1 : 0, isUniqueToday ? 1 : 0],
            });

            return res.status(200).json({ message: 'View tracked.' });

        } else if (req.method === 'GET') {
            const { view, period, domain } = req.query;

            // Handle request for graph data
            if (view === 'graph') {
                let format, interval;
                switch (period) {
                    case 'weekly': format = '%Y-%m-%d'; interval = '-7 days'; break;
                    case 'monthly': format = '%Y-%m-%d'; interval = '-30 days'; break;
                    case 'yearly': format = '%Y-%m'; interval = '-1 year'; break;
                    default: format = '%Y-%m-%d %H:00'; interval = '-24 hours'; break;
                }

                // --- MODIFIED: Graph query now uses visitor_id for true unique counts ---
                let sql = `
                    SELECT
                        strftime(?, timestamp) as date,
                        COUNT(*) as total_views,
                        COUNT(DISTINCT visitor_id) as unique_views
                    FROM analytics_timeseries
                    WHERE timestamp >= datetime('now', ?)
                `;
                const args = [format, interval];

                if (domain && domain !== 'all') {
                    sql += ` AND domain = ?`;
                    args.push(domain);
                }

                sql += ` GROUP BY date ORDER BY date ASC;`;
                
                const graphData = await client.execute({ sql, args });
                return res.status(200).json(graphData.rows);
            }

            // --- MODIFIED: Handle request for summary table data with time periods ---
            let summaryInterval;
            switch (req.query.period) {
                case 'weekly': summaryInterval = '-7 days'; break;
                case 'monthly': summaryInterval = '-30 days'; break;
                default: summaryInterval = '-24 hours'; break; // Default to daily
            }

            // Query the main timeseries table for accurate, period-based data
            const result = await client.execute({
                sql: `
                    SELECT
                        url,
                        domain,
                        COUNT(*) as views,
                        COUNT(DISTINCT visitor_id) as unique_views
                    FROM analytics_timeseries
                    WHERE timestamp >= datetime('now', ?)
                    GROUP BY url, domain
                `,
                args: [summaryInterval],
            });

            const analyticsByDomain = result.rows.reduce((acc, row) => {
                const { domain, url, views, unique_views } = row;
                if (!acc[domain]) acc[domain] = [];
                acc[domain].push({ url, views, unique_views });
                return acc;
            }, {});
            return res.status(200).json(analyticsByDomain);
            // --- END OF MODIFICATION ---

        } else {
            res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('A critical error occurred in the analytics function:', error);
        return res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
}