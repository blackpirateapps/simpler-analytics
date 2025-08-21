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
                    // Attempt to insert the new hash. This will fail if the hash already exists
                    // due to the PRIMARY KEY constraint, which is what we want.
                    await client.execute({
                        sql: "INSERT INTO daily_unique_visitors (visitor_hash, day) VALUES (?, ?)",
                        args: [visitorHash, today],
                    });
                    isUnique = true; // If insert succeeds, it's a unique visitor
                } catch (error) {
                    // We expect a "UNIQUE constraint failed" error for repeat visitors, which we can ignore.
                    if (!error.message.includes('UNIQUE constraint failed')) {
                        throw error; // Re-throw other unexpected errors
                    }
                }
            }

            // --- Update Database ---
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
