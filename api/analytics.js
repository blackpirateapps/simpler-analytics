import { createClient } from '@libsql/client';

// Turso database connection configuration
// Make sure to set these environment variables in your Vercel project
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper function to create the tables if they don't exist
async function setupDatabase() {
    try {
        // Create a table for general analytics like total views
        await client.execute(`
            CREATE TABLE IF NOT EXISTS analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL UNIQUE,
                count INTEGER NOT NULL
            );
        `);
        
        // Create a table to store unique IP addresses that have visited
        await client.execute(`
            CREATE TABLE IF NOT EXISTS ip_views (
                ip TEXT PRIMARY KEY
            );
        `);

        // Check if a 'views' record exists, if not, create one.
        const result = await client.execute({
            sql: "SELECT count FROM analytics WHERE type = ?",
            args: ["views"],
        });

        if (result.rows.length === 0) {
            await client.execute({
                sql: "INSERT INTO analytics (type, count) VALUES (?, ?)",
                args: ["views", 0],
            });
        }
    } catch (error)
        console.error("Error setting up database:", error);
    }
}

// Initialize the database on startup
setupDatabase();

export default async function handler(req, res) {
    try {
        if (req.method === 'POST') {
            // Get the user's IP address from the request headers.
            // 'x-forwarded-for' is the standard header for identifying the originating IP address.
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            if (!ip) {
                return res.status(400).json({ message: 'Could not identify IP address.' });
            }

            try {
                // Attempt to insert the new IP address.
                // The PRIMARY KEY constraint on the 'ip' column will cause this to fail
                // if the IP address already exists, which is what we want.
                await client.execute({
                    sql: "INSERT INTO ip_views (ip) VALUES (?)",
                    args: [ip],
                });

                // If the insert was successful (meaning it's a new IP), increment the view count.
                await client.execute({
                    sql: "UPDATE analytics SET count = count + 1 WHERE type = ?",
                    args: ["views"],
                });

                return res.status(200).json({ message: 'New view tracked.' });

            } catch (error) {
                // This error is expected if the IP already exists (due to UNIQUE constraint).
                // We can safely ignore it and just report that the view was not double-counted.
                if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.message.includes('UNIQUE constraint failed')) {
                    return res.status(200).json({ message: 'IP has already been recorded.' });
                }
                // If it's a different error, we should log it.
                throw error;
            }

        } else if (req.method === 'GET') {
            // Get the total unique view count
            const result = await client.execute({
                sql: "SELECT count FROM analytics WHERE type = ?",
                args: ["views"],
            });
            const views = result.rows.length > 0 ? result.rows[0].count : 0;
            return res.status(200).json({ views });
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('Error in analytics function:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

