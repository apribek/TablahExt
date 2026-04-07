// Search Crawler (Level 1)
// Injects into active tabs, extracts hit lists, pings backend filter, and kicks off Level 2

let sweeperActive = false;
let currentPortalConfig = null;

const startSweep = async (portalId) => {
    sweeperActive = true;
    currentPortalConfig = window.PORTALS[portalId];
    
    // Announce to UI
    showSweepOverlay("Sweeper Active: Scraping page...");
    
    await processSearchPage();
};

const processSearchPage = async () => {
    if (!sweeperActive || !currentPortalConfig) return;

    // 1. Gather job cards
    const sels = currentPortalConfig.listLevelSelectors;
    const cards = document.querySelectorAll(sels.cardContainer);
    
    if (cards.length === 0) {
        showSweepOverlay("No job cards found on page. Stopping.", true);
        sweeperActive = false;
        return;
    }

    const jobExcerpts = [];
    cards.forEach((card, index) => {
        const titleEl = card.querySelector(sels.title);
        const compEl = card.querySelector(sels.company);
        const locEl = card.querySelector(sels.location);
        const excEl = card.querySelector(sels.excerpt);
        const linkEl = card.querySelector(sels.link) || card.closest('a') || card.querySelector('a');

        if (titleEl && linkEl) {
            jobExcerpts.push({
                index,
                title: titleEl.innerText.trim(),
                company: compEl ? compEl.innerText.trim() : null,
                location: locEl ? locEl.innerText.trim() : null,
                excerpt: excEl ? excEl.innerText.trim() : null,
                link: linkEl.href
            });
        }
    });

    showSweepOverlay(`Sending ${jobExcerpts.length} jobs to Tablah AI Filter...`);

    // 2. Ping cv-aution backend for Bulk Filtering
    try {
        const token = await getAuthToken(); // inherited from content.js or we redeclare
        if (!token) throw new Error("Not authenticated with Tablah.");

        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'apiFetch',
                url: `${CONFIG.API_BASE}/jobs/ext-bulk-filter`,
                options: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: jobExcerpts, portal: currentPortalConfig.domain })
                }
            }, res => {
                if (res && res.ok) resolve(res.data);
                else reject(new Error(res?.error || "Filter request failed"));
            });
        });

        const approvedIndices = response.results.filter(r => r.is_match).map(r => r.index);
        const approvedLinks = jobExcerpts.filter(j => approvedIndices.includes(j.index)).map(j => j.link);

        showSweepOverlay(`Filter complete: ${approvedLinks.length} hits approved, ${jobExcerpts.length - approvedLinks.length} junk dropped. Initiating Level 2 extractions...`);

        // 3. Send approved links to Service Worker to spawn detail tabs sequentially
        if (approvedLinks.length > 0) {
            chrome.runtime.sendMessage({
                action: 'processDetailTabs',
                links: approvedLinks
            });
        } else {
             // 4. No hits? Just go to next page
             goToNextPage();
        }
    } catch (e) {
        console.error("Tablah Sweep Error:", e);
        showSweepOverlay(`Error: ${e.message}`, true);
        sweeperActive = false;
    }
};

const goToNextPage = () => {
    if (!sweeperActive || !currentPortalConfig) return;
    
    const nextBtn = document.querySelector(currentPortalConfig.nextPageSelector);
    if (nextBtn) {
        const delay = Math.floor(Math.random() * 2000) + 2000; // 2-4 seconds stealth delay
        showSweepOverlay(`Navigating to Next Page in ${delay/1000}s...`);
        setTimeout(() => {
            window.location.href = nextBtn.href || nextBtn.getAttribute('href');
            // the content script will reload, we need to persist state via chrome.storage
        }, delay);
    } else {
        showSweepOverlay("No more pages found. Sweep complete.", true);
        sweeperActive = false;
        chrome.storage.local.set({ sweepState: null });
    }
};

// Check if we need to auto-resume after a page navigation
chrome.storage.local.get(['sweepState'], (data) => {
    if (data.sweepState && data.sweepState.active) {
        // Wait for page to fully render before processing
        setTimeout(() => startSweep(data.sweepState.portalId), 2000);
    }
});

// Listener for Service Worker indicating all details are processed
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'detailTabsFinished') {
        goToNextPage();
    }
});

// --- UI Overlay for Sweeper ---
const showSweepOverlay = (statusText, isDone=false) => {
    let ov = document.getElementById('tablah-sweep-ov');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'tablah-sweep-ov';
        ov.style.cssText = `position:fixed; top:20px; right:20px; background:#0f172a; color:#38bdf8; padding:15px; border-radius:10px; z-index:99999; box-shadow:0 10px 30px rgba(0,0,0,0.5); font-family:sans-serif; border: 1px solid #1e293b;`;
        document.body.appendChild(ov);
    }
    ov.innerHTML = `<strong>Tablah Auto-Sweep</strong><br/><span style="color:#cbd5e1;font-size:12px;">${statusText}</span>`;
    
    if (isDone) {
        const closeBtn = document.createElement('button');
        closeBtn.innerText = "Close";
        closeBtn.style.cssText = "display:block; margin-top:10px; background:#ef4444; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;";
        closeBtn.onclick = () => ov.remove();
        ov.appendChild(closeBtn);
    }
};
