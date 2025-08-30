// Pizzle Analytics Tracking Script
(function() {
  'use strict';
  
  // Configuration - replace with your domain
  const ANALYTICS_ENDPOINT = '/api/track';
  
  // Track page view
  function trackPageView() {
    try {
      // Use tracking pixel method (GET request)
      const img = new Image();
      img.src = ANALYTICS_ENDPOINT + 
        '?referrer=' + encodeURIComponent(document.referrer || '') +
        '&timestamp=' + Date.now();
      
      // Alternative: Use fetch for POST request
      /*
      fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          referrer: document.referrer || null,
          url: window.location.href,
          title: document.title
        })
      }).catch(function(error) {
        console.log('Analytics tracking failed:', error);
      });
      */
    } catch (error) {
      // Silently fail to avoid breaking the host site
      console.log('Analytics tracking failed:', error);
    }
  }
  
  // Track immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView);
  } else {
    trackPageView();
  }
})();