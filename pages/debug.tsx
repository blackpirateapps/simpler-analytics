import { useState } from 'react';
import Head from 'next/head';

export default function Debug() {
  const [results, setResults] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const testEndpoint = async (endpoint: string, method: string = 'GET') => {
    setLoading(true);
    try {
      const options: RequestInit = {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      };
      
      if (method === 'POST') {
        options.body = JSON.stringify({
          referrer: document.referrer || null,
          url: window.location.href,
          title: document.title + ' (Debug Test)',
          timestamp: Date.now()
        });
      }

      const response = await fetch(endpoint, options);
      const data = await response.text();
      
      setResults(prev => ({
        ...prev,
        [endpoint + '_' + method]: {
          status: response.status,
          statusText: response.statusText,
          data: data,
          headers: Object.fromEntries(response.headers.entries())
        }
      }));
    } catch (error) {
      setResults(prev => ({
        ...prev,
        [endpoint + '_' + method]: {
          error: error.message
        }
      }));
    }
    setLoading(false);
  };

  return (
    <>
      <Head>
        <title>Debug - Pizzle Analytics</title>
      </Head>

      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            🔍 Debug Dashboard
          </h1>

          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Environment Check</h2>
            <div className="space-y-2 text-sm">
              <p><strong>Database URL:</strong> {process.env.TURSO_DATABASE_URL ? '✅ Set' : '❌ Missing'}</p>
              <p><strong>Auth Token:</strong> {process.env.TURSO_AUTH_TOKEN ? '✅ Set' : '❌ Missing'}</p>
              <p><strong>Current URL:</strong> {typeof window !== 'undefined' ? window.location.href : 'Loading...'}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Test Endpoints</h2>
            <div className="space-x-2 mb-4">
              <button
                onClick={() => testEndpoint('/api/track', 'POST')}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                disabled={loading}
              >
                Test POST /api/track
              </button>
              <button
                onClick={() => testEndpoint('/api/track', 'GET')}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                disabled={loading}
              >
                Test GET /api/track
              </button>
              <button
                onClick={() => testEndpoint('/api/analytics')}
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
                disabled={loading}
              >
                Test GET /api/analytics
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Results</h2>
            {Object.keys(results).length === 0 ? (
              <p className="text-gray-500">Click a test button to see results</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(results).map(([key, result]: [string, any]) => (
                  <div key={key} className="border rounded p-4">
                    <h3 className="font-semibold text-lg mb-2">{key}</h3>
                    {result.error ? (
                      <div className="text-red-600">
                        <strong>Error:</strong> {result.error}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <strong>Status:</strong> {result.status} {result.statusText}
                        </div>
                        <div>
                          <strong>Response:</strong>
                          <pre className="bg-gray-100 p-2 rounded text-sm overflow-x-auto">
                            {result.data}
                          </pre>
                        </div>
                        <details>
                          <summary className="cursor-pointer font-medium">Response Headers</summary>
                          <pre className="bg-gray-100 p-2 rounded text-sm mt-2">
                            {JSON.stringify(result.headers, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Troubleshooting Tips:</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• If environment variables show "❌ Missing", add them in Vercel dashboard</li>
              <li>• POST /api/track should return JSON with success: true</li>
              <li>• GET /api/track should return a tiny image (Content-Type: image/gif)</li>
              <li>• /api/analytics should return analytics data</li>
              <li>• Check Vercel function logs for detailed errors</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps() {
  return {
    props: {
      hasDbUrl: !!process.env.TURSO_DATABASE_URL,
      hasAuthToken: !!process.env.TURSO_AUTH_TOKEN,
    },
  };
}