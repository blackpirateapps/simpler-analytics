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

            // --- Privacy-Preserving Unique Visitor Logic ---
            let isUnique = false;
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

            if (ip && userAgent) {
                const hashInput = `${ip}-${userAgent}-${today}`;
                const visitorHash = crypto.createHash('sha256').update(hashInput).digest('hex');

                try {
                    await client.execute({
                        sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                        args: [visitorHash, today],
                    });
                    isUnique = true;
                } catch (error) {
                    if (!error.message.includes('UNIQUE constraint failed')) throw error;
                }
            }

            // --- Update Database ---
            await client.execute({
                sql: "INSERT INTO analytics_timeseries (url, domain, is_unique) VALUES (?, ?, ?)",
                args: [url, new URL(url).hostname, isUnique],
            });

            await client.execute({
                sql: `
                    INSERT INTO page_views (url, domain, views, unique_views) VALUES (?, ?, 1, ?)
                    ON CONFLICT(url) DO UPDATE SET
                        views = views + 1,
                        unique_views = unique_views + ?;
                `,
                args: [url, new URL(url).hostname, isUnique ? 1 : 0, isUnique ? 1 : 0],
            });

            return res.status(200).json({ message: 'View tracked.' });

        } else if (req.method === 'GET') {
            const { view, period, domain } = req.query;

            // Handle request for graph data
            if (view === 'graph') {
                let format, interval;
                switch (period) {
                    case 'weekly':
                        format = '%Y-%m-%d'; // Group by day
                        interval = '-7 days';
                        break;
                    case 'monthly':
                        format = '%Y-%m-%d'; // Group by day
                        interval = '-30 days';
                        break;
                    case 'yearly':
                        format = '%Y-%m'; // Group by month
                        interval = '-1 year';
                        break;
                    default: // daily
                        format = '%Y-%m-%d %H:00'; // Group by hour
                        interval = '-24 hours';
                        break;
                }

                let sql = `
                    SELECT
                        strftime(?, timestamp) as date,
                        COUNT(*) as total_views,
                        SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
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

            // Default: Handle request for summary table data
            const result = await client.execute("SELECT url, domain, views, unique_views FROM page_views");
            const analyticsByDomain = result.rows.reduce((acc, row) => {
                const { domain, url, views, unique_views } = row;
                if (!acc[domain]) acc[domain] = [];
                acc[domain].push({ url, views, unique_views });
                return acc;
            }, {});
            return res.status(200).json(analyticsByDomain);
        } else {
            res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('A critical error occurred in the analytics function:', error);
        return res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
}
