const API_BASE = CONFIG.API_BASE;

const generateHash = async (text) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const getAuthToken = async () => {
    const data = await chrome.storage.local.get(['clerk_token']);
    return data.clerk_token;
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

const getUniversalRawText = () => {
    // Inject spinner CSS if not present
    if (!document.getElementById('tablah-spin-styles')) {
        const style = document.createElement('style');
        style.id = 'tablah-spin-styles';
        style.innerHTML = `
            @keyframes tablah-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .tablah-spin { animation: tablah-rotate 1.2s linear infinite; }
            #tablah-widget.loading { pointer-events: none; opacity: 0.8; }
        `;
        document.head.appendChild(style);
    }
    const main = document.querySelector('main') || document.querySelector('article') || document.body;
    return main.innerText.trim();
};

const showQuickScore = async (widget) => {
    if (widget.dataset.loading === "true") return;
    
    const textEl = widget.querySelector('span');
    const iconEl = widget.querySelector('img');
    const token = await getAuthToken();
    
    if (!token) {
        textEl.innerText = 'Login to Tablah';
        widget.dataset.authRequired = "true";
        return;
    }
    widget.dataset.authRequired = "false";

    const raw_text = getUniversalRawText();
    if (!raw_text || raw_text.length < 100) return;

    // Set Loading State
    widget.dataset.loading = "true";
    widget.classList.add('loading');
    textEl.innerText = 'Analyzing...';
    if (iconEl) iconEl.classList.add('tablah-spin');

    try {
        const assessment = await apiFetch(`${API_BASE}/assessments/quick`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ raw_text })
        });

        textEl.innerText = `Fit Score: ${assessment.score}%`;
        widget.style.borderLeft = `4px solid ${assessment.score > 70 ? '#22c55e' : assessment.score > 40 ? '#f59e0b' : '#ef4444'}`;
        widget.dataset.assessment = JSON.stringify(assessment);

        if (assessment.score > 80) {
            widget.style.boxShadow = '0 0 15px rgba(34, 197, 94, 0.4)';
        }
    } catch (e) {
        console.error("Quick assess error:", e);
        if (e.message.includes('tokenExpired') || e.message.includes('401')) {
            textEl.innerText = 'Session Expired - Login';
            widget.dataset.authRequired = "true";
        } else {
            textEl.innerText = 'Retry Analysis';
        }
    } finally {
        // Reset Loading State
        widget.dataset.loading = "false";
        widget.classList.remove('loading');
        if (iconEl) iconEl.classList.remove('tablah-spin');
    }
};

const clearWidgetState = (widget) => {
    widget.dataset.assessment = "";
    widget.dataset.jobData = "";
    widget.style.borderLeft = "none";
    widget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.6)";

    const overlay = document.getElementById('tablah-overlay');
    if (overlay) overlay.remove();

    const textEl = widget.querySelector('span');
    if (textEl) textEl.innerText = "Analyze Fit";
};

const createWidget = () => {
    let widget = document.getElementById('tablah-widget');
    if (widget) {
        clearWidgetState(widget);
        return;
    }

    widget = document.createElement('div');
    widget.id = 'tablah-widget';
    // ... rest of style ...
    widget.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 10000;
        background: #0f172a;
        color: white;
        padding: 12px 16px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.6);
        font-family: 'Inter', -apple-system, sans-serif;
        border: 1px solid rgba(255,255,255,0.15);
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-width: 320px;
        font-size: 14px;
        letter-spacing: -0.01em;
    `;

    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('/icons/icon48.png');
    icon.style.width = '24px';
    icon.style.height = '24px';
    icon.style.borderRadius = '5px';

    const text = document.createElement('span');
    text.innerText = 'Analyze Fit';
    text.style.fontWeight = '600';

    widget.appendChild(icon);
    widget.appendChild(text);

    widget.onmouseenter = () => widget.style.transform = 'translateY(-5px) scale(1.02)';
    widget.onmouseleave = () => widget.style.transform = 'translateY(0) scale(1)';

    widget.onclick = () => {
        if (widget.dataset.authRequired === "true") {
            window.open('http://localhost:3000', '_blank');
            return;
        }
        const assessment = widget.dataset.assessment ? JSON.parse(widget.dataset.assessment) : null;
        if (assessment) {
            showOverlay(assessment);
        } else {
            showQuickScore(widget);
        }
    };

    document.body.appendChild(widget);
};

const showOverlay = (assessment) => {
    let overlay = document.getElementById('tablah-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'tablah-overlay';
    overlay.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 24px;
        width: 680px;
        max-height: 80vh;
        overflow-y: auto;
        background: #1e293b;
        color: #f8fafc;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        z-index: 10001;
        padding: 24px;
        font-family: 'Inter', system-ui, sans-serif;
        border: 1px solid rgba(255,255,255,0.1);
        animation: slideIn 0.3s ease-out;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } }
            .t-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; display: flex; justify-content: space-between; }
            .t-score { color: #38bdf8; }
            .t-section { margin-bottom: 15px; }
            .t-heading { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; margin-bottom: 5px; font-weight: 600; }
            .t-body { font-size: 13px; line-height: 1.5; color: #cbd5e1; }
            .t-close { cursor: pointer; color: #94a3b8; font-size: 20px; }
            .t-btn { background: #2563eb; color: white; border: none; padding: 10px; border-radius: 6px; width: 100%; margin-top: 10px; font-weight: 600; cursor: pointer; }
        </style>
        <div class="t-title">
            <span>${assessment.job_title || 'AI Assessment'}</span>
            <span class="t-close">&times;</span>
        </div>
        <div class="t-section">
            <div class="t-heading">Company</div>
            <div class="t-body" style="font-weight: 600;">${assessment.job_company || 'Unknown Company'} (${assessment.job_location || 'Unknown Location'})</div>
        </div>
        <div class="t-section">
            <div class="t-heading">Fit Score</div>
            <div class="t-body t-score" style="font-size: 24px; font-weight: 800;">${assessment.score}%</div>
        </div>
        <div class="t-section">
            <div class="t-heading">Strengths</div>
            <div class="t-body">${assessment.strengths}</div>
        </div>
        <div class="t-section">
            <div class="t-heading">Gap Analysis</div>
            <div class="t-body">${assessment.weaknesses}</div>
        </div>
        <button class="t-btn" id="t-import-btn">Import to Tablah</button>
    `;

    overlay.querySelector('.t-close').onclick = () => overlay.remove();
    overlay.querySelector('#t-import-btn').onclick = async (e) => {
        const btn = e.target;
        btn.innerText = 'Importing...';
        btn.disabled = true;
        
        try {
            const token = await getAuthToken();
            const raw_text = getUniversalRawText();
            const cleaned_description = assessment.job_description || raw_text;
            const job_hash = await generateHash(cleaned_description + window.location.href);
            
            const response = await apiFetch(`${API_BASE}/jobs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: assessment.job_title || "Unknown Title",
                    company: assessment.job_company || "Unknown Company",
                    description: cleaned_description,
                    location: assessment.job_location,
                    link: window.location.href,
                    source: window.location.host,
                    status: 'NEW',
                    is_manual: false,
                    job_hash: job_hash
                })
            });
            
            btn.innerText = 'View in Tablah';
            btn.style.backgroundColor = '#22c55e';
            btn.disabled = false;
            const dashboardUrl = `${CONFIG.APP_URL}/en/dashboard/candidate/jobs#job-${response.id}`;
            btn.onclick = () => window.open(dashboardUrl, '_blank');
        } catch (err) {
            btn.innerText = 'Error';
            btn.disabled = false;
        }
    };

    document.body.appendChild(overlay);
};

// Site Enablement Helper
const shouldShowWidget = async () => {
    const host = window.location.hostname;
    const defaultSites = ['linkedin.com', 'indeed.com'];
    if (defaultSites.some(s => host.includes(s))) return true;

    const data = await chrome.storage.local.get(['enabled_sites']);
    const enabledSites = data.enabled_sites || [];
    return enabledSites.includes(host);
};

// URL mutation observer to detect job page changes on SPA LinkedIn
let lastUrl = location.href;
let widgetTimeout;
const observer = new MutationObserver(async () => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        clearTimeout(widgetTimeout);
        if (await shouldShowWidget()) {
            widgetTimeout = setTimeout(createWidget, 2000);
        } else {
            const w = document.getElementById('tablah-widget');
            if (w) w.remove();
        }
    }
});
observer.observe(document, { subtree: true, childList: true });

// Initial run
shouldShowWidget().then(show => {
    if (show) widgetTimeout = setTimeout(createWidget, 2000);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrapeJob") {
        sendResponse({ 
            description: getUniversalRawText(), 
            source: window.location.host, 
            link: window.location.href 
        });
    }
    return true;
});

// Auto-Login & Site Enablement Listeners
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        const host = window.location.hostname;

        // 1. Detection of Login/Token change
        if (changes.clerk_token || changes.clerk_session) {
            const token = changes.clerk_token ? changes.clerk_token.newValue : null;
            if (token) {
                const widget = document.getElementById('tablah-widget');
                if (widget && widget.dataset.authRequired === "true") {
                    showQuickScore(widget);
                }
            }
        }

        // 2. Detection of Site Enablement change
        if (changes.enabled_sites) {
            const enabledSites = changes.enabled_sites.newValue || [];
            if (enabledSites.includes(host)) {
                if (!document.getElementById('tablah-widget')) {
                    createWidget();
                }
            } else {
                const defaultSites = ['linkedin.com', 'indeed.com'];
                if (!defaultSites.some(s => host.includes(s))) {
                    const w = document.getElementById('tablah-widget');
                    if (w) w.remove();
                }
            }
        }
    }
});
