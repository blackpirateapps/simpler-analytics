const { createClient } = require('@libsql/client');

// Turso database connection configuration
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper function to set CORS headers
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
    // Set CORS headers for all responses
    setCorsHeaders(res);

    // Handle the browser's preflight request
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        if (req.method === 'POST') {
            const { data } = req.body;
            const url = data ? data.u : null;

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
            
            await client.execute({
                sql: `
                    INSERT INTO page_views (url, domain, views) VALUES (?, ?, 1)
                    ON CONFLICT(url) DO UPDATE SET views = views + 1;
                `,
                args: [url, new URL(url).hostname],
            });

            return res.status(200).json({ message: 'View tracked.' });

        } else if (req.method === 'GET') {
            const result = await client.execute("SELECT url, domain, views FROM page_views");

            const analyticsByDomain = result.rows.reduce((acc, row) => {
                const { domain, url, views } = row;
                if (!acc[domain]) {
                    acc[domain] = [];
                }
                acc[domain].push({ url, views });
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
