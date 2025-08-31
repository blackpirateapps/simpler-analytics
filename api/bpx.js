const { createClient } = require('@libsql/client');
const crypto = require('crypto');
// To parse user-agent strings, you would add a library like 'ua-parser-js'
// const UAParser = require('ua-parser-js');

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
            const referrer = data ? data.r : null;
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

            // --- Capture Additional Visitor Details ---
const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            const today = new Date().toISOString().split('T')[0];
            
            // NOTE: In a real project, you'd use a library for robust parsing.
            // const parser = new UAParser(userAgent);
            // const browser = parser.getBrowser().name || 'Unknown';
            // const device_type = parser.getDevice().type || 'desktop';
            
            // Simplified parsing for this example:
            const browser = userAgent.match(/(firefox|chrome|safari|edg|opera)/i)?.[0] || 'Unknown';
            const device_type = userAgent.match(/mobile/i) ? 'mobile' : 'desktop';

            // --- Privacy-Preserving Unique Visitor Logic ---
            let isUnique = false;
const hashInput = `${ip}-${userAgent}-${today}-${url}`;
            const visitorHash = crypto.createHash('sha256').update(hashInput).digest('hex');

            if (ip && userAgent) {
try {
await client.execute({
                        sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                        args: [visitorHash, today],
                    });
isUnique = true;
} catch (error) {
                    if (!error.message.includes('UNIQUE constraint failed')) {
throw error;
                    }
                }
            }

            // --- Update Database ---
            await client.execute({
                sql: `INSERT INTO analytics_timeseries 
                       (url, domain, is_unique, referrer, browser, device_type, ip_address, visitor_hash) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [url, domain, isUnique, referrer, browser, device_type, ip, visitorHash],
            });

await client.execute({
                sql: `
                    INSERT INTO page_views (url, domain, views, unique_views) VALUES (?, ?, 1, ?)
                    ON CONFLICT(url) DO UPDATE SET
views = views + 1, unique_views = unique_views + ?;
                `,
                args: [url, domain, isUnique ? 1 : 0, isUnique ? 1 : 0],
            });
return res.status(200).json({ message: 'View tracked.' });

        } else if (req.method === 'GET') {
            const { view, url: urlParam } = req.query;

            // Handle request for detailed logs for a specific URL
            if (view === 'details' && urlParam) {
                const logData = await client.execute({
                    sql: `SELECT timestamp, referrer, browser, device_type, ip_address
                          FROM analytics_timeseries
                          WHERE url = ?
                          ORDER BY timestamp DESC
                          LIMIT 50`, // Limit to last 50 events for performance
                    args: [urlParam]
                });
                return res.status(200).json(logData.rows);
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
res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('A critical error occurred in the analytics function:', error);
return res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
}