import { createClient } from '@libsql/client';

// Turso database connection configuration
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
    try {
        // Handle POST request to add a new domain
        if (req.method === 'POST') {
            const { domain } = req.body;
            if (!domain || typeof domain !== 'string') {
                return res.status(400).json({ message: 'Domain is required and must be a string.' });
            }

            // Normalize the domain to prevent duplicates (e.g., remove www.)
            const normalizedDomain = domain.replace(/^www\./, '');

            // Insert the domain if it doesn't already exist
            await client.execute({
                sql: "INSERT INTO allowed_domains (domain) VALUES (?) ON CONFLICT(domain) DO NOTHING;",
                args: [normalizedDomain],
            });

            return res.status(201).json({ message: 'Domain added successfully.' });

        // Handle GET request to list all tracked domains
        } else if (req.method === 'GET') {
            const result = await client.execute("SELECT domain FROM allowed_domains");
            const domains = result.rows.map(row => row.domain);
            return res.status(200).json({ domains });
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('Error in domains function:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
