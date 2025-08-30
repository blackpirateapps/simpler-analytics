const { createClient } = require('@libsql/client');
const { createHash } = require('crypto');

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// --- Simple User-Agent Parser ---
function parseUserAgent(ua) {
    if (!ua) return { browser: 'Unknown', device: 'Unknown' };
    let browser = 'Unknown', device = 'Desktop';

    if (/Mobile|iP(hone|od|ad)|Android|BlackBerry|IEMobile|Kindle|NetFront|Silk-Accelerated|(hpw|web)OS|Fennec|Minimo|Opera M(obi|ini)|Blazer|Dolfin|Dolphin|Skyfire|Zune/i.test(ua)) {
        device = 'Mobile';
    }

    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('MSIE') || ua.includes('Trident/')) browser = 'Internet Explorer';
    else if (ua.includes('Edge')) browser = 'Edge';
    
    return { browser, device };
}

// --- Main Handler ---
module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') {
        return res.status(204).json({ headers: corsHeaders });
    }
    try {
        if (req.method === 'POST') await handleTrackingRequest(req, res);
        else if (req.method === 'GET') {
            const view = req.query.view;
            if (view === 'graph') await handleGraphRequest(req, res);
            else if (view === 'domain_summary') await handleDomainSummaryRequest(req, res);
            else if (view === 'domain_details') await handleDomainDetailsRequest(req, res);
            else await handlePageSummaryRequest(req, res);
        } else {
            res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
            res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('Unhandled handler error:', { message: error.message, stack: error.stack });
        res.status(500).json({ message: 'Internal Server Error', error: error.message, headers: corsHeaders });
    }
};

// --- Request Logic ---
async function handleTrackingRequest(req, res) {
    const { u: url, r: referrer } = req.body.data;
    if (!url) return res.status(400).json({ message: 'URL is required', headers: corsHeaders });

    const domain = new URL(url).hostname;
    const allowedDomains = (await db.execute("SELECT domain FROM allowed_domains")).rows.map(r => r.domain);
    if (!allowedDomains.includes(domain)) return res.status(403).json({ message: 'Domain not allowed', headers: corsHeaders });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const { browser, device } = parseUserAgent(userAgent);
    const day = new Date().toISOString().slice(0, 10);
    const uniqueString = `${ip}-${userAgent}-${day}-${url}`;
    const visitorHash = createHash('sha256').update(uniqueString).digest('hex');

    let isUnique = false;
    try {
        await db.execute({ sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)", args: [visitorHash, day] });
        isUnique = true;
    } catch (e) {
        if (e.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') console.error("Uniqueness check DB error:", e);
    }
    
    await db.execute({
        sql: "INSERT INTO analytics_timeseries (url, domain, is_unique, visitor_hash, referrer, browser, device_type, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [url, domain, isUnique, visitorHash, referrer || 'Direct', browser, device, ip],
    });

    res.status(200).json({ message: 'View tracked', headers: corsHeaders });
}

async function handleDomainDetailsRequest(req, res) {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ message: 'Domain parameter is required', headers: corsHeaders });

    const [referrers, browsers, devices, ips] = await Promise.all([
        db.execute({ sql: "SELECT referrer, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? AND referrer IS NOT NULL GROUP BY referrer ORDER BY count DESC LIMIT 10", args: [domain] }),
        db.execute({ sql: "SELECT browser, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? GROUP BY browser ORDER BY count DESC LIMIT 10", args: [domain] }),
        db.execute({ sql: "SELECT device_type, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? GROUP BY device_type ORDER BY count DESC LIMIT 10", args: [domain] }),
        db.execute({ sql: "SELECT ip_address, COUNT(*) as views, MAX(timestamp) as last_visit FROM analytics_timeseries WHERE domain = ? GROUP BY ip_address ORDER BY last_visit DESC LIMIT 20", args: [domain] }),
    ]);

    res.status(200).json({
        referrers: referrers.rows,
        browsers: browsers.rows,
        devices: devices.rows,
        ips: ips.rows,
    }, { headers: corsHeaders });
}

// --- Other GET handlers (graph, summaries) remain the same ---
// [NOTE: The previous code for handleGraphRequest, handleDomainSummaryRequest, and handlePageSummaryRequest is omitted for brevity but should be kept here]
async function handlePageSummaryRequest(req, res) {
    const result = await db.execute(`
        SELECT url, domain, COUNT(*) as views, SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
        FROM analytics_timeseries GROUP BY url, domain
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
        case 'weekly': dateFormat = '%Y-%W'; timeModifier = "WHERE timestamp >= date('now', '-7 days')"; break;
        case 'monthly': dateFormat = '%Y-%m'; timeModifier = "WHERE timestamp >= date('now', '-1 month')"; break;
        case 'yearly': dateFormat = '%Y'; timeModifier = "WHERE timestamp >= date('now', '-1 year')"; break;
        default: dateFormat = '%Y-%m-%d %H:00'; timeModifier = "WHERE timestamp >= date('now', '-1 day')"; break;
    }
    const domainFilter = domain === 'all' ? '' : 'AND domain = ?';
    const query = `
        SELECT strftime('${dateFormat}', timestamp) as date, COUNT(*) as total_views, SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
        FROM analytics_timeseries ${timeModifier} ${domainFilter} GROUP BY date ORDER BY date ASC
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
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND date(timestamp) = date('now')", args: [domain] }),
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND date(timestamp) >= date('now', 'weekday 0', '-6 days')", args: [domain] }),
            db.execute({ sql: "SELECT COUNT(DISTINCT visitor_hash) as count FROM analytics_timeseries WHERE domain = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')", args: [domain] }),
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

