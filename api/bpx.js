import { createClient } from "@libsql/client";
import useragent from "useragent";

function getDB() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

export default async function handler(req, res) {
  const db = getDB();

  if (req.method === "POST") {
    try {
      const { data } = req.body;
      if (!data || !data.u) return res.status(400).json({ message: "Missing URL" });

      const urlObj = new URL(data.u);
      const domain = urlObj.hostname;

      // check if domain is allowed
      const allowed = await db.execute({
        sql: `SELECT 1 FROM allowed_domains WHERE domain = ?`,
        args: [domain],
      });
      if (allowed.rows.length === 0) {
        return res.status(403).json({ message: "Domain not allowed" });
      }

      // collect visitor info
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const ua = req.headers["user-agent"] || "";
      const agent = useragent.parse(ua);

      const visitor_hash = `${ip}-${ua}`;
      const device_type = agent.device.toString();
      const browser = agent.toAgent();

      await db.execute({
        sql: `
          INSERT INTO analytics_timeseries
          (url, domain, referrer, browser, device_type, ip_address, visitor_hash, is_unique)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          data.u,
          domain,
          data.r || null,
          browser,
          device_type,
          ip,
          visitor_hash,
          1, // always unique for now
        ],
      });

      return res.status(200).json({ message: "Event logged" });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }

  if (req.method === "GET") {
    try {
      const result = await db.execute(`
        SELECT domain, url, COUNT(*) as views, COUNT(DISTINCT visitor_hash) as unique_views
        FROM analytics_timeseries
        GROUP BY domain, url
        ORDER BY domain
      `);

      const grouped = {};
      result.rows.forEach((r) => {
        if (!grouped[r.domain]) grouped[r.domain] = [];
        grouped[r.domain].push({
          url: r.url,
          views: r.views,
          unique_views: r.unique_views,
        });
      });

      return res.status(200).json(grouped);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}