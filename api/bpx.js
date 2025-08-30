const { createClient } = require('@libsql/client');
const { createHash } = require('crypto');

// --- Database Client Initialization ---
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// --- CORS Headers ---
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// --- Main Handler ---
module.exports = async (req, res) => {
    // Handle preflight OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        return res.status(204).json({ headers: corsHeaders });
    }

    try {
        if (req.method === 'POST') {
            await handleTrackingRequest(req, res);
        } else if (req.method === 'GET') {
            if (req.query.view === 'graph') {
                await handleGraphRequest(req, res);
            } else if (req.query.view === 'domain_summary') {
                await handleDomainSummaryRequest(req, res);
            }
             else {
                await handleSummaryRequest(req, res);
            }
        } else {
            res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
            res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('Unhandled error in handler:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message, headers: corsHeaders });
    }
};

// --- Request Handlers ---

async function handleTrackingRequest(req, res) {
    console.log("Received tracking request...");
    const { url } = req.body.data;
    if (!url) return res.status(400).json({ message: 'URL is required', headers: corsHeaders });

    const domain = new URL(url).hostname;
    const allowedDomains = (await db.execute("SELECT domain FROM allowed_domains")).rows.map(r => r.domain);

    if (!allowedDomains.includes(domain)) {
        console.log(`Domain not allowed: ${domain}`);
        return res.status(403).json({ message: 'Domain not allowed for tracking', headers: corsHeaders });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const day = new Date().toISOString().slice(0, 10);
    
    // Unique identifier is now based on IP, User Agent, Date, AND the specific URL
    const uniqueString = `${ip}-${userAgent}-${day}-${url}`;
    const visitorHash = createHash('sha256').update(uniqueString).digest('hex');

    let isUnique = false;
    try {
        await db.execute({
            sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
            args: [visitorHash, day],
        });
        isUnique = true;
        console.log(`New unique visitor recorded for URL: ${url}`);
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
             console.log(`Repeat visitor detected for URL: ${url}`);
        } else {
            console.error("Database error checking uniqueness:", e);
        }
    }
    
    await db.execute({
        sql: "INSERT INTO analytics_timeseries (url, domain, is_unique, visitor_hash) VALUES (?, ?, ?, ?)",
        args: [url, domain, isUnique, visitorHash],
    });

    console.log("Tracking data saved successfully.");
    res.status(200).json({ message: 'View tracked', headers: corsHeaders });
}

async function handleSummaryRequest(req, res) {
    const result = await db.execute(`
        SELECT 
            url, 
            domain, 
            COUNT(*) as views, 
            SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
        FROM analytics_timeseries
        GROUP BY url, domain
    `);

    const dataByDomain = result.rows.reduce((acc, row) => {
        if (!acc[row.domain]) acc[row.domain] = [];
        acc[row.domain].push(row);
        return acc;
    }, {});

    res.status(200).json(dataByDomain, { headers: corsHeaders });
}

async function handleGraphRequest(req, res) {
    const { period = 'daily', domain = 'all' } = req.query;
    let dateFormat, timeModifier;

    switch (period) {
        case 'weekly':
            dateFormat = '%Y-%W'; // Year-WeekNumber
            timeModifier = "WHERE timestamp >= date('now', '-7 days')";
            break;
        case 'monthly':
            dateFormat = '%Y-%m'; // Year-Month
            timeModifier = "WHERE timestamp >= date('now', '-1 month')";
            break;
        case 'yearly':
            dateFormat = '%Y'; // Year
            timeModifier = "WHERE timestamp >= date('now', '-1 year')";
            break;
        case 'daily':
        default:
            dateFormat = '%Y-%m-%d %H:00'; // Hour for daily view
            timeModifier = "WHERE timestamp >= date('now', '-1 day')";
            break;
    }
    
    const domainFilter = domain === 'all' ? '' : 'AND domain = ?';
    const query = `
        SELECT 
            strftime('${dateFormat}', timestamp) as date,
            COUNT(*) as total_views,
            SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
        FROM analytics_timeseries
        ${timeModifier} ${domainFilter}
        GROUP BY date
        ORDER BY date ASC
    `;

    const args = domain === 'all' ? [] : [domain];
    const { rows } = await db.execute({ sql: query, args });
    res.status(200).json(rows, { headers: corsHeaders });
}

async function handleDomainSummaryRequest(req, res) {
    const domainsResult = await db.execute("SELECT domain FROM allowed_domains");
    const domains = domainsResult.rows.map(r => r.domain);
    const summary = {};

    for (const domain of domains) {
        const [daily, weekly, monthly, yearly] = await Promise.all([
            // Daily
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND date(timestamp) = date('now')", args: [domain] }),
            // Weekly
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND date(timestamp) >= date('now', 'weekday 0', '-6 days')", args: [domain] }),
            // Monthly
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')", args: [domain] }),
            // Yearly
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND strftime('%Y', timestamp) = strftime('%Y', 'now')", args: [domain] })
        ]);
        
        summary[domain] = {
            daily: daily.rows[0]?.count || 0,
            weekly: weekly.rows[0]?.count || 0,
            monthly: monthly.rows[0]?.count || 0,
            yearly: yearly.rows[0]?.count || 0,
        };
    }
    
    res.status(200).json(summary, { headers: corsHeaders });
}

