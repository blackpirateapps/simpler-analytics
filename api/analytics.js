import { createClient } from '@libsql/client';

// Turso database connection configuration
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
    try {
        if (req.method === 'POST') {
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({ message: 'URL is required.' });
            }

            let domain;
            try {
                // Normalize domain by removing 'www.' prefix for matching purposes
                domain = new URL(url).hostname.replace(/^www\./, '');
            } catch (error) {
                return res.status(400).json({ message: 'Invalid URL format.' });
            }

            // First, check if the domain is in the allowed list
            const checkResult = await client.execute({
                sql: "SELECT 1 FROM allowed_domains WHERE domain = ?",
                args: [domain],
            });

            // If the domain is not found, reject the request
            if (checkResult.rows.length === 0) {
                return res.status(403).json({ message: `Domain '${domain}' is not tracked.` });
            }
            
            // If the domain is allowed, insert a new row for the URL on first view,
            // or update the view count on subsequent views.
            await client.execute({
                sql: `
                    INSERT INTO page_views (url, domain, views) VALUES (?, ?, 1)
                    ON CONFLICT(url) DO UPDATE SET views = views + 1;
                `,
                // We store the original domain (with www. if present) for display purposes
                args: [url, new URL(url).hostname],
            });

            return res.status(200).json({ message: 'View tracked.' });

        } else if (req.method === 'GET') {
            // Get all page view data
            const result = await client.execute("SELECT url, domain, views FROM page_views");

            // Group the results by domain for the dashboard UI
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
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('Error in analytics function:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
