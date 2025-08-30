const { createClient } = require('@libsql/client');
const crypto = require('crypto');

// --- Helper Functions ---
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// --- Database Client Initialization ---
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// --- Main Handler ---
module.exports = async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        console.log("Handling OPTIONS preflight request.");
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    
    // --- POST Request: Track a new page view ---
    if (req.method === 'POST') {
        try {
            console.log("POST /api/bpx: Received tracking request.");
            const body = await req.json();
            const { u: url, r: referrer } = body.data || {};
            
            if (!url) {
                console.error("POST /api/bpx: Aborting. URL is missing from payload.");
                return new Response(JSON.stringify({ message: "URL is required." }), { status: 400, headers: corsHeaders });
            }
            console.log(`POST /api/bpx: Processing URL: ${url}`);

            const domain = new URL(url).hostname.replace(/^www\./, '');
            
            console.log(`POST /api/bpx: Checking if domain '${domain}' is allowed.`);
            const domainAllowedResult = await db.execute({
                sql: "SELECT 1 FROM allowed_domains WHERE domain = ?",
                args: [domain]
            });

            if (domainAllowedResult.rows.length === 0) {
                console.warn(`POST /api/bpx: Aborting. Domain '${domain}' is not in the allowed list.`);
                return new Response(JSON.stringify({ message: "Domain not tracked." }), { status: 200, headers: corsHeaders });
            }
            console.log(`POST /api/bpx: Domain '${domain}' is allowed. Proceeding.`);

            // --- Unique Visitor Logic ---
            const ip = req.headers['x-forwarded-for'] || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            
            const visitorFingerprint = `${ip}-${userAgent}-${today}-${url}`;
            const visitorHash = crypto.createHash('sha256').update(visitorFingerprint).digest('hex');

            let isUnique = false;
            try {
                await db.execute({
                    sql: "INSERT INTO daily_visitor_hashes (visitor_hash, day) VALUES (?, ?)",
                    args: [visitorHash, today]
                });
                isUnique = true;
                console.log(`POST /api/bpx: New unique visitor recorded for URL. Hash: ${visitorHash}`);
            } catch (e) {
                console.log(`POST /api/bpx: Repeat visitor detected for URL. Hash: ${visitorHash}`);
            }
            
            // --- Parse User Agent ---
            const browser = userAgent.match(/(firefox|chrome|safari|edg|opera|msie|trident)/i)?.[0].toLowerCase() || 'unknown';
            const device = userAgent.match(/(mobile|tablet|desktop)/i)?.[0].toLowerCase() || 'desktop';

            // --- Database Insert ---
            console.log(`POST /api/bpx: Preparing to insert into analytics_timeseries.`);
            await db.execute({
                sql: `INSERT INTO analytics_timeseries (url, domain, is_unique, referrer, browser, device_type, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [url, domain, isUnique, referrer || null, browser, device, ip]
            });
            
            console.log(`POST /api/bpx: SUCCESS! View tracked for ${url}.`);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

        } catch (error) {
            console.error("POST /api/bpx: CRITICAL ERROR during view tracking:", error);
            return new Response(JSON.stringify({ message: "Internal Server Error", error: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    // --- GET Request: Fetch analytics data for the dashboard ---
    if (req.method === 'GET') {
         try {
            const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
            const view = searchParams.get('view');
            
            // --- Domain Details View ---
            if (view === 'domain_details') {
                const domain = searchParams.get('domain');
                if (!domain) return new Response(JSON.stringify({ message: "Domain parameter is required" }), { status: 400 });

                const queries = {
                    referrers: `SELECT referrer, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? AND referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY count DESC LIMIT 20`,
                    browsers: `SELECT browser, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? GROUP BY browser ORDER BY count DESC`,
                    devices: `SELECT device_type, COUNT(*) as count FROM analytics_timeseries WHERE domain = ? GROUP BY device_type ORDER BY count DESC`,
                    ips: `SELECT ip_address, COUNT(*) as views, MAX(timestamp) as last_visit FROM analytics_timeseries WHERE domain = ? GROUP BY ip_address ORDER BY last_visit DESC LIMIT 20`,
                };
                
                const [referrers, browsers, devices, ips] = await Promise.all([
                    db.execute({ sql: queries.referrers, args: [domain] }),
                    db.execute({ sql: queries.browsers, args: [domain] }),
                    db.execute({ sql: queries.devices, args: [domain] }),
                    db.execute({ sql: queries.ips, args: [domain] }),
                ]);

                return new Response(JSON.stringify({
                    referrers: referrers.rows,
                    browsers: browsers.rows,
                    devices: devices.rows,
                    ips: ips.rows,
                }), { status: 200, headers: corsHeaders });
            }
            
            // --- Domain Summary View ---
            else if (view === 'domain_summary') {
                const queries = {
                    daily:   `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE DATE(timestamp) = DATE('now') GROUP BY domain`,
                    weekly:  `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE DATE(timestamp) >= DATE('now', '-7 days') GROUP BY domain`,
                    monthly: `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE STRFTIME('%Y-%m', timestamp) = STRFTIME('%Y-%m', 'now') GROUP BY domain`,
                    yearly:  `SELECT domain, SUM(is_unique) as count FROM analytics_timeseries WHERE STRFTIME('%Y', timestamp) = STRFTIME('%Y', 'now') GROUP BY domain`,
                };

                const [daily, weekly, monthly, yearly] = await Promise.all([
                    db.execute(queries.daily), db.execute(queries.weekly),
                    db.execute(queries.monthly), db.execute(queries.yearly)
                ]);
                
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

            // --- Default View (Page Details Table) ---
            else {
                const pageDetailsQuery = `
                    SELECT
                        url,
                        COUNT(*) as views,
                        SUM(CASE WHEN is_unique = 1 THEN 1 ELSE 0 END) as unique_views
                    FROM analytics_timeseries
                    GROUP BY url
                `;
                const { rows: pageDetails } = await db.execute(pageDetailsQuery);
                const groupedByDomain = pageDetails.reduce((acc, page) => {
                    const domain = new URL(page.url).hostname.replace(/^www\./, '');
                    if (!acc[domain]) acc[domain] = [];
                    acc[domain].push(page);
                    return acc;
                }, {});

                return new Response(JSON.stringify(groupedByDomain), { status: 200, headers: corsHeaders });
            }
        } catch(error) {
             console.error("GET /api/bpx: CRITICAL ERROR during data fetch:", error);
            return new Response(JSON.stringify({ message: "Internal Server Error", error: error.message }), { status: 500, headers: corsHeaders });
        }
    }

    // --- Fallback for other methods ---
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
};

