import { createClient } from '@libsql/client';

// Turso database connection configuration
// Make sure to set these environment variables in your Vercel project
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper function to create the table if it doesn't exist
async function setupDatabase() {
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS analytics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                count INTEGER NOT NULL
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
    } catch (error) {
        console.error("Error setting up database:", error);
    }
}

// Initialize the database on startup
setupDatabase();

export default async function handler(req, res) {
    try {
        if (req.method === 'POST') {
            // Increment the view count
            await client.execute({
                sql: "UPDATE analytics SET count = count + 1 WHERE type = ?",
                args: ["views"],
            });
            return res.status(200).json({ message: 'View tracked.' });
        } else if (req.method === 'GET') {
            // Get the total view count
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

