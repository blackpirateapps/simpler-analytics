// Vercel Serverless Function to serve the tracking script.
// This script is self-contained and dynamically finds its API endpoint.

module.exports = (req, res) => {
    // This is the minified tracking logic.
    // It finds its own origin to construct the API endpoint URL, so it's portable.
    const scriptContent = `(()=>{const t=document.currentScript,o=new URL(t.src).origin+"/api/bpx",e=location.href;let n=Date.now();const s=()=>{if("hidden"===document.visibilityState&&n){let t=(Date.now()-n)/1e3;t>0.5&&navigator.sendBeacon(o,JSON.stringify({type:"duration",data:{u:e,d:t}})),n=null}else"visible"===document.visibilityState&&(n=Date.now())};fetch(o,{method:"POST",body:JSON.stringify({type:"pageview",data:{u:e,r:document.referrer}}),headers:{"Content-Type":"application/json"},mode:"cors"}).catch(()=>{}),document.addEventListener("visibilitychange",s),addEventListener("beforeunload",s)})();`;

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Cache the script in the user's browser for 24 hours to reduce server load.
    res.setHeader('Cache-Control', 'public, max-age=86400'); 
    res.status(200).send(scriptContent);
};
