const { createClient } = require('@libsql/client');
const crypto = require('crypto');

// --- Configuration & Helpers ---
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const getDomainFromUrl = (url) => new URL(url).hostname.replace(/^www\./, '');

// --- Main API Handler ---
module.exports = async (req) => {
    // 1. Handle CORS Preflight Request
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 2. Handle Data Tracking (POST requests)
    if (req.method === 'POST') {
        return await handleTrackingRequest(req);
    }

    // 3. Handle Data Fetching (GET requests)
    if (req.method === 'GET') {
        return await handleDataRequest(req);
    }

    // 4. Fallback for other methods
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
};

// --- Logic for Tracking New Views ---
async function handleTrackingRequest(req) {
    try {
        const body = await req.json();
        const { u: url, r: referrer } = body.data || {};
        
        if (!url) {
            return new Response(JSON.stringify({ message: "URL is required." }), { status: 400, headers: corsHeaders });
        }

        const domain = getDomainFromUrl(url);
        
        const domainAllowedResult = await db.execute({
            sql: "SELECT 1 FROM allowed_domains WHERE domain = ?",
            args: [domain]
        });

        if (domainAllowedResult.rows.length === 0) {
            return new Response(JSON.stringify({ message: "Domain not tracked." }), { status: 200, headers: corsHeaders });
        }

        // --- Unique Visitor Logic ---
        const ip = req.headers['x-forwarded-for'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const today = new Date().toISOString().slice(0, 10);
        const visitorFingerprint = `${ip}-${userAgent}-${today}-${url}`;
        const visitorHash = crypto.createHash('sha256').update(visitorFingerprint).digest('hex');

        let isUnique = false;
        try {
            await db.execute({
                sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                args: [visitorHash, today]
            });
            isUnique = true;
        } catch (e) {
            // Repeat visitor for this page today
        }
        
        // --- Data Parsing ---
        const browser = userAgent.match(/(firefox|chrome|safari|edg|opera|msie|trident)/i)?.[0].toLowerCase() || 'unknown';
        const device = userAgent.match(/(mobile|tablet|desktop)/i)?.[0].toLowerCase() || 'desktop';

        // --- Database Insert ---
        await db.execute({
            sql: `INSERT INTO analytics_timeseries (url, domain, is_unique, referrer, browser, device_type, ip_address, visitor_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [url, domain, isUnique, referrer || null, browser, device, ip, visitorHash]
        });
        
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

    } catch (error) {
        console.error("TRACKING ERROR:", error);
        return new Response(JSON.stringify({ message: "Internal Server Error", error: error.message }), { status: 500, headers: corsHeaders });
    }
}

// --- Logic for Fetching Analytics Data ---
async function handleDataRequest(req) {
    try {
        const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
        const view = searchParams.get('view');
        
        // --- Route to the correct data handler based on 'view' parameter ---
        switch (view) {
            case 'domain_details':
                return await getDomainDetails(searchParams.get('domain'));
            case 'domain_summary':
                return await getDomainSummaries();
            default:
                return await getDefaultPageList();
        }
    } catch(error) {
        console.error("DATA FETCH ERROR:", error);
        return new Response(JSON.stringify({ message: "Internal Server Error", error: error.message }), { status: 500, headers: corsHeaders });
    }
}

// --- Specific Data Fetcher Functions ---

async function getDomainDetails(domain) {
    if (!domain) return new Response(JSON.stringify({ message: "Domain parameter is required" }), { status: 400 });

    const queries = {
        referrers: `SELECT referrer, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? AND referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY count DESC LIMIT 20`,
        browsers: `SELECT browser, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? GROUP BY browser ORDER BY count DESC`,
        devices: `SELECT device_type, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? GROUP BY device_type ORDER BY count DESC`,
        latest_visitors: `SELECT timestamp, url, ip_address, browser, referrer, visitor_hash FROM analytics_timeseries WHERE domain = ? ORDER BY timestamp DESC LIMIT 20`,
    };
    
    const [referrers, browsers, devices, latest_visitors] = await Promise.all([
        db.execute({ sql: queries.referrers, args: [domain] }),
        db.execute({ sql: queries.browsers, args: [domain] }),
        db.execute({ sql: queries.devices, args: [domain] }),
        db.execute({ sql: queries.latest_visitors, args: [domain] }),
    ]);

    return new Response(JSON.stringify({
        referrers: referrers.rows,
        browsers: browsers.rows,
        devices: devices.rows,
        latest_visitors: latest_visitors.rows,
    }), { status: 200, headers: corsHeaders });
}

async function getDomainSummaries() {
    const queries = {
        daily:   `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE DATE(timestamp) = DATE('now') GROUP BY domain`,
        weekly:  `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE DATE(timestamp) >= DATE('now', '-7 days') GROUP BY domain`,
        monthly: `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE STRFTIME('%Y-%m', timestamp) = STRFTIME('%Y-%m', 'now') GROUP BY domain`,
        yearly:  `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE STRFTIME('%Y', timestamp) = STRFTIME('%Y', 'now') GROUP BY domain`,
    };

    const [daily, weekly, monthly, yearly] = await Promise.all(Object.values(queries).map(sql => db.execute(sql)));
    
    const summary = {};
    const processResults = (rows, period) => {
        rows.forEach(row => {
            if (!summary[row.domain]) summary[row.domain] = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
            summary[row.domain][period] = row.count || 0;
        });
    };

    processResults(daily.rows, 'daily');
    processResults(weekly.rows, 'weekly');
    processResults(monthly.rows, 'monthly');
    processResults(yearly.rows, 'yearly');

    return new Response(JSON.stringify(summary), { status: 200, headers: corsHeaders });
}

async function getDefaultPageList() {
    const { rows } = await db.execute(`
        SELECT url, COUNT(*) as views, SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
        FROM analytics_timeseries GROUP BY url ORDER BY views DESC
    `);
    
    const groupedByDomain = rows.reduce((acc, page) => {
        const domain = getDomainFromUrl(page.url);
        if (!acc[domain]) acc[domain] = [];
        acc[domain].push(page);
        return acc;
    }, {});

    return new Response(JSON.stringify(groupedByDomain), { status: 200, headers: corsHeaders });
}

