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

            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'] || '';
            const referrer = data.r || 'direct';
            const today = new Date().toISOString().split('T')[0];

            // Use a hash of IP and User Agent as the unique identifier
            const visitorHash = crypto.createHash('sha256').update(`${ip}-${userAgent}`).digest('hex');

            // Insert unique visitor data into the daily_visitor_hashes table
            try {
                await client.execute({
                    sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day, ip_address, user_agent, referrer) VALUES (?, ?, ?, ?, ?)",
                    args: [visitorHash, today, ip, userAgent, referrer],
                });
            } catch (error) {
                if (!error.message.includes('UNIQUE constraint failed')) {
                    throw error; // Re-throw if it's not a unique constraint violation
                }
                // If it's a unique constraint violation, we just continue, as the visitor is already recorded for the day.
            }

            // Insert the page view event, linking it with the visitor hash
            await client.execute({
                sql: "INSERT INTO analytics_timeseries (url, domain, is_unique, visitor_id) VALUES (?, ?, ?, ?)",
                args: [url, domain, 0, visitorHash], // visitor_id now stores the visitorHash
            });

            return res.status(200).json({ message: 'View tracked.' });

        } else if (req.method === 'GET') {
            const { view, period, domain } = req.query;

            // --- CORRECTED: Visitor Log Endpoint ---
            if (view === 'visitors') {
                const sql = `
                    SELECT v.day, v.ip_address, v.user_agent, v.referrer, a.url
                    FROM daily_visitor_hashes v
                    JOIN analytics_timeseries a ON v.visitor_hash = a.visitor_id
                    WHERE a.domain = ?
                    ORDER BY a.timestamp DESC LIMIT 100
                `;
                if (!domain) return res.status(400).json({ message: 'A domain must be provided.'});
                const visitorData = await client.execute({ sql, args: [domain] });
                return res.status(200).json(visitorData.rows);
            }

            // ... (The rest of the GET logic for graphs and summaries would go here,
            //      joining analytics_timeseries and daily_visitor_hashes on visitor_id/visitor_hash)

        } else {
            res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('A critical error occurred in the analytics function:', error);
        return res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
}