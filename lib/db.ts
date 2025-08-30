import { createClient } from '@libsql/client';

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

export interface AnalyticsData {
  id?: number;
  ip: string;
  user_agent: string;
  referrer: string | null;
  browser: string;
  device: string;
  created_at?: string;
}