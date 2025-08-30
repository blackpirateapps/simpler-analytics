import { useState } from 'react';
import Head from 'next/head';

interface TestResult {
  status?: number;
  statusText?: string;
  data?: string;
  headers?: Record<string, string>;
  error?: string;
}

interface TestResults {
  [key: string]: TestResult;
}

interface DebugProps {
  hasDbUrl: boolean;
  hasAuthToken: boolean;
}

export default function Debug({ hasDbUrl, hasAuthToken }: DebugProps) {
  const [results, setResults] = useState<TestResults>({});
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
          referrer: typeof document !== 'undefined' ? document.referrer || null : null,
          url: typeof window !== 'undefined' ? window.location.href : 'test-url',
          title: typeof document !== 'undefined' ? document.title + ' (Debug Test)' : 'Debug Test',
          timestamp: Date.now()
        });
      }

      const response = await fetch(endpoint, options);
      const data = await response.text();
      
      setResults((prev: TestResults) => ({
        ...prev,
        [endpoint + '_' + method]: {
          status: response.status,
          statusText: response.statusText,
          data: data,
          headers: Object.fromEntries(response.headers.entries())
        }
      }));
    } catch (error: any) {
      setResults((prev: TestResults) => ({
        ...prev,
        [endpoint + '_' + method]: {
          error: error.message || 'Unknown error occurred'
        }
      }));
    }
    setLoading(false);
  };

  return (
    <>
      <Head>
        <title>🔍 Debug Tools - Pizzle Analytics</title>
        <meta name="description" content="Debug and test your analytics tracking" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        {/* Header */}
        <div className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex items-center space-x-3">
              <div className="text-3xl">🔍</div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Debug Tools</h1>
                <p className="text-gray-600">Test and troubleshoot your analytics setup</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
          
          {/* Environment Status */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="text-2xl mr-3">⚙️</span>
              Environment Status
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className={`p-4 rounded-lg ${hasDbUrl ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center">
                  <span className="text-2xl mr-3">{hasDbUrl ? '✅' : '❌'}</span>
                  <div>
                    <div className="font-medium">Database URL</div>
                    <div className={`text-sm ${hasDbUrl ? 'text-green-700' : 'text-red-700'}`}>
                      {hasDbUrl ? 'Configured' : 'Missing - Add TURSO_DATABASE_URL'}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className={`p-4 rounded-lg ${hasAuthToken ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center">
                  <span className="text-2xl mr-3">{hasAuthToken ? '✅' : '❌'}</span>
                  <div>
                    <div className="font-medium">Auth Token</div>
                    <div className={`text-sm ${hasAuthToken ? 'text-green-700' : 'text-red-700'}`}>
                      {hasAuthToken ? 'Configured' : 'Missing - Add TURSO_AUTH_TOKEN'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {(!hasDbUrl || !hasAuthToken) && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-start">
                  <span className="text-xl mr-3">⚠️</span>
                  <div>
                    <div className="font-medium text-yellow-800 mb-2">Environment Variables Missing</div>
                    <div className="text-sm text-yellow-700 space-y-1">
                      <div>1. Go to your Vercel dashboard → Project → Settings → Environment Variables</div>
                      <div>2. Add the missing variables from your Turso setup</div>
                      <div>3. Redeploy your application</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Test Endpoints */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="text-2xl mr-3">🧪</span>
              Test Endpoints
            </h2>
            <div className="space-y-3 mb-6">
              <button
                onClick={() => testEndpoint('/api/track', 'POST')}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                disabled={loading}
              >
                <span className="mr-2">📤</span>
                Test POST /api/track
              </button>
              
              <button
                onClick={() => testEndpoint('/api/track', 'GET')}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                disabled={loading}
              >
                <span className="mr-2">🖼️</span>
                Test GET /api/track (Pixel)
              </button>
              
              <button
                onClick={() => testEndpoint('/api/analytics')}
                className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                disabled={loading}
              >
                <span className="mr-2">📊</span>
                Test GET /api/analytics
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
                <span className="text-gray-600">Testing...</span>
              </div>
            )}
          </div>

          {/* Results */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="text-2xl mr-3">📋</span>
              Test Results
            </h2>
            
            {Object.keys(results).length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-4">🔬</div>
                <p>Click a test button above to see results</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(results).map(([key, result]) => (
                  <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b">
                      <h3 className="font-semibold text-lg flex items-center">
                        <span className="mr-2">
                          {result.error ? '❌' : result.status === 200 ? '✅' : '⚠️'}
                        </span>
                        {key.replace('_', ' → ')}
                      </h3>
                    </div>
                    
                    <div className="p-4 space-y-3">
                      {result.error ? (
                        <div className="text-red-600 bg-red-50 p-3 rounded">
                          <strong>Error:</strong> {result.error}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center space-x-4">
                            <span className={`px-3 py-1 rounded text-sm font-medium ${
                              result.status === 200 ? 'bg-green-100 text-green-800' : 
                              result.status && result.status >= 400 ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {result.status} {result.statusText}
                            </span>
                          </div>
                          
                          <div>
                            <strong className="block mb-2">Response:</strong>
                            <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto max-h-32">
                              {result.data}
                            </pre>
                          </div>
                          
                          <details className="border border-gray-200 rounded">
                            <summary className="cursor-pointer px-3 py-2 bg-gray-50 font-medium hover:bg-gray-100">
                              Response Headers
                            </summary>
                            <pre className="p-3 text-sm overflow-x-auto">
                              {JSON.stringify(result.headers, null, 2)}
                            </pre>
                          </details>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Troubleshooting Guide */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-6">
            <h3 className="font-semibold text-blue-900 mb-4 flex items-center text-lg">
              <span className="text-2xl mr-3">💡</span>
              Troubleshooting Guide
            </h3>
            <div className="grid md:grid-cols-2 gap-4 text-blue-800 text-sm">
              <div className="space-y-2">
                <div className="font-medium">✅ Success Indicators:</div>
                <ul className="space-y-1 ml-4">
                  <li>• POST /api/track returns JSON with success: true</li>
                  <li>• GET /api/track returns image/gif (small response)</li>
                  <li>• /api/analytics returns analytics data</li>
                </ul>
              </div>
              <div className="space-y-2">
                <div className="font-medium">🚨 Common Issues:</div>
                <ul className="space-y-1 ml-4">
                  <li>• 500 errors = Database connection problems</li>
                  <li>• Environment variables missing or incorrect</li>
                  <li>• Need to redeploy after adding env vars</li>
                  <li>• Check Vercel function logs for details</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Back to Dashboard */}
          <div className="text-center">
            <a
              href="/"
              className="inline-flex items-center bg-gray-800 text-white px-6 py-3 rounded-lg hover:bg-gray-900 transition-colors"
            >
              <span className="mr-2">🏠</span>
              Back to Dashboard
            </a>
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