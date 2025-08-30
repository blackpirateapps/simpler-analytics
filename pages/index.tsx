import { useState, useEffect } from 'react';
import Head from 'next/head';

interface AnalyticsData {
  totalVisits: number;
  topBrowsers: Array<{ browser: string; count: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  topDevices: Array<{ device: string; count: number }>;
  dailyVisits: Array<{ date: string; count: number }>;
  period: string;
}

export default function Dashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7');
  const [currentDomain, setCurrentDomain] = useState('');

  useEffect(() => {
    fetchAnalytics();
    if (typeof window !== 'undefined') {
      setCurrentDomain(window.location.origin);
    }
  }, [period]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/analytics?days=${period}`);
      const analyticsData = await response.json();
      setData(analyticsData);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // You could add a toast notification here
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <div className="text-xl text-gray-700">Loading analytics...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-lg shadow-lg">
          <div className="text-6xl mb-4">⚠️</div>
          <div className="text-xl text-red-600 mb-4">Failed to load analytics data</div>
          <button 
            onClick={fetchAnalytics}
            className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>🍕 Pizzle Analytics Dashboard</title>
        <meta name="description" content="Website analytics dashboard" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🍕</text></svg>" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Header */}
        <div className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="text-3xl">🍕</div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Pizzle Analytics</h1>
                  <p className="text-sm text-gray-500">Privacy-focused website analytics</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {['7', '30', '90'].map((days) => (
                  <button
                    key={days}
                    onClick={() => setPeriod(days)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      period === days
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:shadow-sm'
                    }`}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          
          {/* Main Stats */}
          <div className="mb-8">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-lg p-8 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-4xl font-bold mb-2">
                    {data.totalVisits.toLocaleString()}
                  </div>
                  <div className="text-blue-100 text-lg">
                    Total visits in the last {data.period}
                  </div>
                </div>
                <div className="text-6xl opacity-20">
                  📊
                </div>
              </div>
            </div>
          </div>

          {/* Analytics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Top Browsers */}
            <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center mb-4">
                <div className="text-2xl mr-3">🌐</div>
                <h2 className="text-lg font-semibold text-gray-900">Top Browsers</h2>
              </div>
              <div className="space-y-3">
                {data.topBrowsers.slice(0, 5).map((browser, index) => {
                  const percentage = data.totalVisits > 0 ? (browser.count / data.totalVisits * 100).toFixed(1) : '0';
                  return (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center flex-1 min-w-0">
                        <div className="w-3 h-3 rounded-full bg-blue-500 mr-3 flex-shrink-0"></div>
                        <span className="text-sm text-gray-600 truncate">
                          {browser.browser}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 ml-3">
                        <span className="text-xs text-gray-400">{percentage}%</span>
                        <span className="text-sm font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded">
                          {browser.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Referrers */}
            <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center mb-4">
                <div className="text-2xl mr-3">🔗</div>
                <h2 className="text-lg font-semibold text-gray-900">Top Referrers</h2>
              </div>
              <div className="space-y-3">
                {data.topReferrers.slice(0, 5).map((referrer, index) => {
                  const percentage = data.totalVisits > 0 ? (referrer.count / data.totalVisits * 100).toFixed(1) : '0';
                  const displayName = referrer.referrer === 'Direct' ? 'Direct' : (() => {
                    try {
                      return new URL(referrer.referrer).hostname;
                    } catch {
                      return referrer.referrer;
                    }
                  })();
                  
                  return (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center flex-1 min-w-0">
                        <div className="w-3 h-3 rounded-full bg-green-500 mr-3 flex-shrink-0"></div>
                        <span className="text-sm text-gray-600 truncate" title={referrer.referrer}>
                          {displayName}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 ml-3">
                        <span className="text-xs text-gray-400">{percentage}%</span>
                        <span className="text-sm font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded">
                          {referrer.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Devices */}
            <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center mb-4">
                <div className="text-2xl mr-3">📱</div>
                <h2 className="text-lg font-semibold text-gray-900">Top Devices</h2>
              </div>
              <div className="space-y-3">
                {data.topDevices.slice(0, 5).map((device, index) => {
                  const percentage = data.totalVisits > 0 ? (device.count / data.totalVisits * 100).toFixed(1) : '0';
                  const colors = ['bg-purple-500', 'bg-yellow-500', 'bg-red-500', 'bg-indigo-500', 'bg-pink-500'];
                  
                  return (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center flex-1 min-w-0">
                        <div className={`w-3 h-3 rounded-full ${colors[index % colors.length]} mr-3 flex-shrink-0`}></div>
                        <span className="text-sm text-gray-600">
                          {device.device}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 ml-3">
                        <span className="text-xs text-gray-400">{percentage}%</span>
                        <span className="text-sm font-medium text-gray-900 bg-gray-100 px-2 py-1 rounded">
                          {device.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Daily Visits Chart */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8 hover:shadow-xl transition-shadow">
            <div className="flex items-center mb-6">
              <div className="text-2xl mr-3">📈</div>
              <h2 className="text-lg font-semibold text-gray-900">Daily Visits</h2>
            </div>
            <div className="h-64 flex items-end space-x-1 bg-gray-50 rounded-lg p-4">
              {data.dailyVisits.map((day, index) => {
                const maxVisits = Math.max(...data.dailyVisits.map(d => d.count));
                const height = maxVisits > 0 ? (day.count / maxVisits) * 100 : 0;
                
                return (
                  <div key={index} className="flex-1 flex flex-col items-center group">
                    <div className="relative flex-1 flex items-end w-full">
                      <div
                        className="bg-gradient-to-t from-blue-500 to-blue-400 w-full rounded-t hover:from-blue-600 hover:to-blue-500 transition-colors cursor-pointer relative group-hover:shadow-lg"
                        style={{ height: `${height}%`, minHeight: height > 0 ? '4px' : '2px' }}
                        title={`${day.date}: ${day.count} visits`}
                      >
                        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {day.count} visits
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2 transform -rotate-45 origin-left whitespace-nowrap">
                      {new Date(day.date).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Integration Instructions */}
          <div className="bg-white rounded-xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="flex items-center mb-6">
              <div className="text-2xl mr-3">⚙️</div>
              <h2 className="text-xl font-semibold text-gray-900">Integration Instructions</h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              {/* JavaScript Tracking */}
              <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-6">
                <h3 className="text-lg font-medium text-blue-900 mb-3 flex items-center">
                  <span className="text-xl mr-2">📜</span>
                  JavaScript Tracking
                </h3>
                <p className="text-blue-700 text-sm mb-4">
                  Add this script to any website you want to track:
                </p>
                <div className="relative">
                  <pre className="bg-white border border-blue-200 p-4 rounded text-sm overflow-x-auto text-gray-800">
{`<script src="${currentDomain}/track.js"></script>`}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(`<script src="${currentDomain}/track.js"></script>`)}
                    className="absolute top-2 right-2 bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* Tracking Pixel */}
              <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-lg p-6">
                <h3 className="text-lg font-medium text-green-900 mb-3 flex items-center">
                  <span className="text-xl mr-2">🖼️</span>
                  Tracking Pixel
                </h3>
                <p className="text-green-700 text-sm mb-4">
                  No-JavaScript tracking (works in emails too):
                </p>
                <div className="relative">
                  <pre className="bg-white border border-green-200 p-4 rounded text-sm overflow-x-auto text-gray-800">
{`<img src="${currentDomain}/api/track" width="1" height="1" alt="" />`}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(`<img src="${currentDomain}/api/track" width="1" height="1" alt="" />`)}
                    className="absolute top-2 right-2 bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* API Integration */}
              <div className="bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg p-6">
                <h3 className="text-lg font-medium text-purple-900 mb-3 flex items-center">
                  <span className="text-xl mr-2">🔌</span>
                  Direct API Call
                </h3>
                <p className="text-purple-700 text-sm mb-4">
                  For custom integrations and server-side tracking:
                </p>
                <div className="relative">
                  <pre className="bg-white border border-purple-200 p-4 rounded text-sm overflow-x-auto text-gray-800">
{`fetch('${currentDomain}/api/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    referrer: document.referrer,
    url: window.location.href,
    title: document.title
  })
});`}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(`fetch('${currentDomain}/api/track', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    referrer: document.referrer,\n    url: window.location.href,\n    title: document.title\n  })\n});`)}
                    className="absolute top-2 right-2 bg-purple-600 text-white px-3 py-1 rounded text-xs hover:bg-purple-700 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* Test Integration */}
              <div className="bg-gradient-to-r from-yellow-50 to-yellow-100 rounded-lg p-6">
                <h3 className="text-lg font-medium text-yellow-900 mb-3 flex items-center">
                  <span className="text-xl mr-2">🧪</span>
                  Test Your Integration
                </h3>
                <p className="text-yellow-700 text-sm mb-4">
                  Verify tracking is working correctly:
                </p>
                <div className="space-y-2">
                  <a
                    href="/debug"
                    className="inline-block bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700 transition-colors text-sm"
                  >
                    🔍 Open Debug Tools
                  </a>
                  <p className="text-xs text-yellow-600">
                    Test all tracking methods and see detailed logs
                  </p>
                </div>
              </div>
            </div>

            {/* Privacy Notice */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="font-medium text-gray-900 mb-2 flex items-center">
                <span className="text-lg mr-2">🔒</span>
                Privacy Information
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                This analytics system collects minimal data: IP addresses (for unique counting), 
                user agents (for browser/device detection), and referrer URLs (for traffic source analysis). 
                No cookies are used, and no personal data is stored. Ensure compliance with privacy 
                regulations (GDPR, CCPA, etc.) by adding appropriate privacy notices to tracked websites.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}