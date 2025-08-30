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

  useEffect(() => {
    fetchAnalytics();
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading analytics...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-red-600">Failed to load analytics data</div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Pizzle Analytics Dashboard</title>
        <meta name="description" content="Website analytics dashboard" />
      </Head>

      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Analytics Dashboard
            </h1>
            
            <div className="flex gap-2 mb-6">
              {['7', '30', '90'].map((days) => (
                <button
                  key={days}
                  onClick={() => setPeriod(days)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    period === days
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {days} days
                </button>
              ))}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <div className="text-2xl font-bold text-blue-900">
                {data.totalVisits.toLocaleString()}
              </div>
              <div className="text-blue-700">
                Total visits in the last {data.period}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Top Browsers */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Top Browsers
              </h2>
              <div className="space-y-2">
                {data.topBrowsers.slice(0, 5).map((browser, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 truncate">
                      {browser.browser}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {browser.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Referrers */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Top Referrers
              </h2>
              <div className="space-y-2">
                {data.topReferrers.slice(0, 5).map((referrer, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 truncate">
                      {referrer.referrer === 'Direct' 
                        ? 'Direct' 
                        : new URL(referrer.referrer).hostname
                      }
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {referrer.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Devices */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Top Devices
              </h2>
              <div className="space-y-2">
                {data.topDevices.slice(0, 5).map((device, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">
                      {device.device}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {device.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Daily Visits Chart */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Daily Visits
            </h2>
            <div className="h-64 flex items-end space-x-2">
              {data.dailyVisits.map((day, index) => {
                const maxVisits = Math.max(...data.dailyVisits.map(d => d.count));
                const height = maxVisits > 0 ? (day.count / maxVisits) * 100 : 0;
                
                return (
                  <div key={index} className="flex-1 flex flex-col items-center">
                    <div
                      className="bg-blue-500 w-full rounded-t"
                      style={{ height: `${height}%`, minHeight: '2px' }}
                      title={`${day.date}: ${day.count} visits`}
                    />
                    <div className="text-xs text-gray-500 mt-2 transform -rotate-45">
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
          <div className="bg-white rounded-lg shadow p-6 mt-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Integration Instructions
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Add tracking script to your website:
                </h3>
                <code className="block bg-gray-100 p-3 rounded text-sm">
                  {`<script src="${window.location.origin}/track.js"></script>`}
                </code>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Or use the tracking pixel:
                </h3>
                <code className="block bg-gray-100 p-3 rounded text-sm">
                  {`<img src="${window.location.origin}/api/track" width="1" height="1" alt="" />`}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}