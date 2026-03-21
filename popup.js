const API_BASE = CONFIG.API_BASE;
const APP_URL = CONFIG.APP_URL;

const generateHash = async (text) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

let jobData = null;
let authToken = null;
let currentAssessment = null;

const openAppTab = async (url) => {
    const tabs = await chrome.tabs.query({ url: `${APP_URL}/*` });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url, active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url });
    }
};

const checkAuth = async () => {
    // Try to get token from storage first
    const data = await chrome.storage.local.get(['clerk_token']);
    if (data.clerk_token) {
        authToken = data.clerk_token;
        return true;
    }

    // In a real scenario, we'd look for the cookie from the main app's domain
    try {
        const cookies = await chrome.cookies.getAll({ domain: CONFIG.COOKIE_DOMAIN });
        const sessionCookie = cookies.find(c => c.name.startsWith('__client_unv_')); // Clerk cookie pattern
        if (sessionCookie) {
            // Simplified for scratch/demo: If we have the cookie, we consider it authenticated
        }
    } catch (e) {
        console.error("Cookie access error:", e);
    }
    
    return !!authToken;
};

const showView = (viewId) => {
    document.getElementById('tablah-main-view').style.display = viewId === 'main' ? 'block' : 'none';
    document.getElementById('tablah-auth-view').style.display = viewId === 'auth' ? 'block' : 'none';
};

const showError = (msg) => {
    const errorEl = document.getElementById('tablah-error');
    errorEl.innerText = msg;
    errorEl.style.display = 'block';
    setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
};

const genericScrape = async (btn, useContext = true) => {
    if (btn.disabled) return null;
    
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Scraping...";

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("No active tab found");

        const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext });
        
        if (response && response.status === "redirecting") {
            setLoadingState(true, "Navigating to full profile...");
            window.close(); // Close popup as the page is navigating
            return null;
        }

        if (!response || !response.text) {
            btn.innerText = "Select text & retry";
            btn.disabled = false;
            
            // Highlight feedback
            const originalColor = btn.style.backgroundColor;
            btn.style.backgroundColor = '#475569';
            setTimeout(() => {
                btn.style.backgroundColor = originalColor;
                if (btn.innerText === "Select text & retry") btn.innerText = originalText;
            }, 3000);
            return null;
        }
        return response;
    } catch (e) {
        console.error("Scraping error:", e);
        showError("Could not read page content. Try selecting text manually.");
        btn.disabled = false;
        btn.innerText = originalText;
        return null;
    }
};

const apiFetch = async (url, options) => {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'apiFetch', url, options }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response.ok) {
                resolve(response.data);
            } else {
                reject(new Error(response.error || `HTTP error! status: ${response.status}`));
            }
        });
    });
};

const setLoadingState = (show, text = "Processing...") => {
    const overlay = document.getElementById('tablah-loading-overlay');
    const textEl = document.getElementById('tablah-loading-text');
    if (show) {
        textEl.innerText = text;
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
};

const assessJob = async () => {
    const btn = document.getElementById('tablah-btn-assess');
    const importBtn = document.getElementById('tablah-btn-import');
    
    // Scrape fresh if we don't have jobData or if re-analyzing
    if (!jobData || !jobData.text) {
        const result = await genericScrape(btn, true);
        if (!result) return;
        jobData = result;
    }

    setLoadingState(true, "Analyzing Fit...");
    document.getElementById('tablah-assessment-result').style.display = 'none';
    document.getElementById('tablah-job-info-card').style.opacity = '0.5';
    
    btn.disabled = true;
    importBtn.disabled = true;

    try {
        const assessment = await apiFetch(`${API_BASE}${CONFIG.QUICK_API_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ raw_text: jobData.text })
        });

        currentAssessment = assessment;

        // Update UI with AI-parsed metadata
        if (assessment.job_title) document.getElementById('tablah-job-title').innerText = assessment.job_title;
        if (assessment.job_company) document.getElementById('tablah-job-company').innerText = assessment.job_company;

        document.getElementById('tablah-score-value').innerText = `${assessment.score}%`;
        document.getElementById('tablah-strengths-text').innerText = assessment.strengths;
        document.getElementById('tablah-weaknesses-text').innerText = assessment.weaknesses;
        
        document.getElementById('tablah-assessment-result').style.display = 'block';
        document.getElementById('tablah-assessment-details').style.display = 'block';
        btn.innerText = "Re-Analyze Fit";
    } catch (e) {
        showError(e.message);
        btn.innerText = "Analyze Fit";
    } finally {
        setLoadingState(false);
        document.getElementById('tablah-job-info-card').style.opacity = '1';
        btn.disabled = false;
        importBtn.disabled = false;
    }
};

const importJob = async () => {
    const btn = document.getElementById('tablah-btn-import');
    
    if (!jobData || !jobData.text) {
        const result = await genericScrape(btn, true);
        if (!result) return;
        jobData = result;
    }

    setLoadingState(true, "Generating Job Draft...");
    btn.disabled = true;

    try {
        const draft = await apiFetch(`${API_BASE}${CONFIG.DRAFT_API_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ raw_text: jobData.text })
        });

        await openAppTab(importUrl);
        
        btn.innerText = "View in Tablah";
        btn.classList.replace('btn-outline', 'btn-primary');
        btn.style.backgroundColor = 'var(--success)';
        btn.disabled = false;
        btn.onclick = async () => await openAppTab(importUrl);
    } catch (e) {
        showError(e.message);
        btn.innerText = "Import Job";
        btn.disabled = false;
    } finally {
        setLoadingState(false);
    }
};

const importProfile = async () => {
    const btn = document.getElementById('tablah-btn-import-profile');
    const result = await genericScrape(btn, true);
    if (!result) return;

    setLoadingState(true, "Generating Profile Draft...");
    btn.disabled = true;

    try {
        const draft = await apiFetch(`${API_BASE}${CONFIG.DRAFT_API_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ raw_text: result.text })
        });

        await openAppTab(importUrl);
        
        btn.innerText = "Imported!";
        btn.style.backgroundColor = 'var(--success)';
        setTimeout(() => {
            btn.innerText = "Import Profile";
            btn.style.backgroundColor = '';
            btn.disabled = false;
        }, 2000);
    } catch (e) {
        showError(e.message);
        btn.innerText = "Import Profile";
        btn.disabled = false;
    } finally {
        setLoadingState(false);
    }
};

// Listeners
document.getElementById('tablah-btn-assess').addEventListener('click', assessJob);
document.getElementById('tablah-btn-import-profile').addEventListener('click', importProfile);
document.getElementById('tablah-btn-import').addEventListener('click', importJob);
document.getElementById('tablah-btn-login').addEventListener('click', async () => {
    await openAppTab(APP_URL);
});

// Init
(async () => {
    const isAuthenticated = await checkAuth();
    
    // Get current tab info for site enablement
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        try {
            const host = new URL(tab.url).hostname;
            document.getElementById('tablah-site-host').innerText = host;

            const data = await chrome.storage.local.get(['enabled_sites']);
            const enabledSites = data.enabled_sites || [];
            
            const toggle = document.getElementById('tablah-site-toggle');
            toggle.checked = enabledSites.includes(host);
            document.getElementById('tablah-site-host').innerText = host;

            toggle.onchange = async () => {
                const results = await chrome.storage.local.get(['enabled_sites']);
                let current = results.enabled_sites || [];
                if (toggle.checked) {
                    if (!current.includes(host)) current.push(host);
                } else {
                    current = current.filter(s => s !== host);
                }
                await chrome.storage.local.set({ enabled_sites: current });
            };
        } catch (e) {
            console.warn("Could not determine hostname for site toggle", e);
        }
    }

    if (!isAuthenticated) {
        showView('auth');
    } else {
        showView('main');
        
        // Initial "quiet" scrape to prepare jobData
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true }, response => {
                if (response && response.text) {
                    jobData = response;
                    document.getElementById('tablah-job-title').innerText = "Page Scanned";
                    document.getElementById('tablah-job-company').innerText = "Click Analyze to see fit score";
                } else {
                    document.getElementById('tablah-job-title').innerText = "Job not found";
                    document.getElementById('tablah-job-company').innerText = "Select description text manually";
                }
            });
        }
    }
})();

// Allow setting token via console for power users
window.setToken = (token) => {
    chrome.storage.local.set({ clerk_token: token }, () => {
        location.reload();
    });
};
