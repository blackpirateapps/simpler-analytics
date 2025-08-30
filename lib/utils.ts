import { UAParser } from 'ua-parser-js';

export function parseUserAgent(userAgent: string) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  
  const browser = result.browser.name ? 
    `${result.browser.name} ${result.browser.version || ''}`.trim() : 
    'Unknown Browser';
    
  const device = result.device.type || 'Desktop';
  
  return {
    browser,
    device: device.charAt(0).toUpperCase() + device.slice(1)
  };
}

export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  return 'unknown';
}