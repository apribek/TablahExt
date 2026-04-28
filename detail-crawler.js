// Detail Crawler (Level 2)
// This script runs automatically on the individual job detail tabs spawned by the background worker.

chrome.storage.local.get(['activeDetailScrapeURL'], async (data) => {
    // Only engage if this tab is the one actively tracked by the service worker
    if (data.activeDetailScrapeURL && window.location.href.includes(data.activeDetailScrapeURL)) {
        // Let the page render
        setTimeout(async () => {
            const rawText = getUniversalRawText ? getUniversalRawText(true) : document.body.innerText;
            
            if (rawText && rawText.length > 200) {
                // We're good, trigger silent import instead of opening the dashboard overlay.
                chrome.runtime.sendMessage({
                    action: 'silentImport',
                    type: 'jobs',
                    text: rawText,
                    link: window.location.href,
                    source: window.location.host
                }, (response) => {
                    // Tell background we are done with this tab so it can close and pop the next one.
                    chrome.runtime.sendMessage({ action: 'detailTabDone', url: window.location.href });
                });
            } else {
                console.error("Tablah Sweep Error: Failed to extract detail JD text.");
                chrome.runtime.sendMessage({ action: 'detailTabDone', url: window.location.href, error: "Empty Extract" });
            }
        }, 1500); // Wait 1.5s for dynamic content
    }
});
