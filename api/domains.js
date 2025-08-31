const { createClient } = require('@libsql/client');

// Turso database connection configuration
const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper function to set CORS headers
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        // Handle POST request to add a new domain
        if (req.method === 'POST') {
            const { domain } = req.body;
            if (!domain || typeof domain !== 'string') {
                return res.status(400).json({ message: 'Domain is required and must be a string.' });
            }
            const normalizedDomain = domain.replace(/^www\./, '');
            await client.execute({
                sql: "INSERT INTO allowed_domains (domain) VALUES (?) ON CONFLICT(domain) DO NOTHING;",
                args: [normalizedDomain],
            });
            return res.status(201).json({ message: 'Domain added successfully.' });
        } 
        
        // Handle GET request to list all tracked domains
        else if (req.method === 'GET') {
            const result = await client.execute("SELECT domain FROM allowed_domains ORDER BY domain ASC");
            const domains = result.rows.map(row => row.domain);
            return res.status(200).json({ domains });
        } 
        
        // Handle DELETE request to remove a domain
        else if (req.method === 'DELETE') {
            const { domain } = req.body;
            if (!domain) {
                return res.status(400).json({ message: 'Domain is required.' });
            }
            await client.execute({
                sql: "DELETE FROM allowed_domains WHERE domain = ?",
                args: [domain],
            });
            return res.status(200).json({ message: 'Domain deleted successfully.' });
        } 
        
        // Handle other methods
        else {
            res.setHeader('Allow', ['GET', 'POST', 'DELETE', 'OPTIONS']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('Error in domains function:', error);
        const errorMessage = error.message || 'An unknown database error occurred.';
        return res.status(500).json({ message: `Internal Server Error: ${errorMessage}` });
    }
}
