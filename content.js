const API_BASE = CONFIG.API_BASE;


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

let lastClickedElement = null;
const trackClick = e => {
    lastClickedElement = e.target;
};
document.addEventListener('contextmenu', trackClick, true);
document.addEventListener('click', trackClick, true);

const findLinkedInExperienceLink = () => {
    if (!window.location.host.includes('linkedin.com')) return null;
    console.log("Tablah: Checking for LinkedIn experience links...");
    
    // Look for links that contain "/details/experience/"
    const links = Array.from(document.querySelectorAll('a[href*="/details/experience/"]'));
    if (links.length > 0) {
        console.log("Tablah: Found experience link via href:", links[0].href);
        return links[0];
    }
    
    // Fallback: search by text for "all" and "experience"
    const allLinks = document.querySelectorAll('a, button');
    for (const link of allLinks) {
        const text = (link.innerText || link.getAttribute('aria-label') || "").toLowerCase();
        // Common variants: "Show all experience", "See all experience", "View all experience"
        if ((text.includes('show all') || text.includes('see all') || text.includes('view all')) && 
            text.includes('experience')) {
            console.log("Tablah: Found experience link via text:", text);
            return link;
        }
    }
    console.log("Tablah: No experience link found.");
    return null;
};

const getUniversalRawText = (useContext = false) => {
    // Priority 1: Selection (Must be substantial)
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const selectedText = selection.toString().trim();
        if (selectedText.length > 100) {
            console.log("Tablah: Harvesting from user selection");
            return selectedText;
        }
    }

    // Priority 2: Context-Aware Ascent (Smart Generic Fallback)
    // We ascend from the last clicked element to find a container that looks like a "Main" part
    if (useContext && lastClickedElement) {
        let el = lastClickedElement.nodeType === 3 ? lastClickedElement.parentElement : lastClickedElement;
        
        while (el && el.parentElement && el.tagName !== 'BODY') {
            const rect = el.getBoundingClientRect();
            const textLen = el.innerText.trim().length;
            
            // If the element covers a large visual area and has enough text, it's a good candidate
            if (rect.width > window.innerWidth * 0.4 && textLen > 400 && textLen < 20000) {
                console.log(`Tablah: Harvesting from ascending container (${el.tagName})`);
                return el.innerText.trim();
            }
            
            if (['ARTICLE', 'MAIN', 'SECTION'].includes(el.tagName)) {
                 if (textLen > 300) {
                    console.log(`Tablah: Harvesting from semantic container (${el.tagName})`);
                    return el.innerText.trim();
                 }
            }
             
            el = el.parentElement;
        }
    }

    // Priority 3: Common Semantic Containers
    const main = document.querySelector('main') || 
                 document.querySelector('article') || 
                 document.querySelector('.scaffold-layout__main') ||
                 document.querySelector('.pv-profile-section');

    if (main) {
        const text = main.innerText.trim();
        // Relaxed threshold for experiences which might be shorter than job posts
        if (text.length > 300) {
            console.log("Tablah: Harvesting from best-match semantic container");
            return text;
        }
    }

    return null;
};

const showQuickScore = async (widget, useContext = false) => {
    if (widget && widget.dataset.loading === "true") return;
    
    // Fallback: If no widget, show a loading placeholder in the overlay
    if (!widget) {
        showOverlay({ loading: true });
    }

    const textEl = widget ? document.getElementById('tablah-analyze-text') : null;
    const iconEl = widget ? document.querySelector('#tablah-btn-analyze img') : null;
    const token = await getAuthToken();
    
    if (!token) {
        if (textEl) {
            textEl.innerText = 'Login to Tablah';
            widget.dataset.authRequired = "true";
        } else {
            showOverlay({ error: 'Please login to Tablah to use AI Assessment.' });
        }
        return;
    }
    
    if (widget) {
        widget.dataset.authRequired = "false";
        widget.dataset.loading = "true";
        widget.classList.add('loading');
        if (textEl) textEl.innerText = 'Analyzing...';
        if (iconEl) iconEl.classList.add('tablah-spin');
    }

    try {
        const raw_text = getUniversalRawText(useContext);
        if (!raw_text) {
            if (textEl) textEl.innerText = 'Select text & retry';
            else showOverlay({ error: 'No content found. Please select the job description text and try again.' });
            return;
        }

        const assessment = await apiFetch(`${CONFIG.API_BASE}${CONFIG.QUICK_API_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw_text })
        });
        
        if (widget) {
            if (textEl) textEl.innerText = `Fit Score: ${assessment.score}%`;
            widget.style.borderLeft = `4px solid ${assessment.score > 70 ? '#22c55e' : assessment.score > 40 ? '#f59e0b' : '#ef4444'}`;
            widget.dataset.assessment = JSON.stringify(assessment);
        }
        
        showOverlay(assessment, raw_text);
    } catch (e) {
        console.error("Quick assess error:", e);
        if (textEl) textEl.innerText = 'Retry Analysis';
        else showOverlay({ error: 'Analysis failed. Please check your connection and try again.' });
    } finally {
        if (widget) {
            widget.dataset.loading = "false";
            widget.classList.remove('loading');
            if (iconEl) iconEl.classList.remove('tablah-spin');
        }
    }
};

const getPageType = () => {
    const host = window.location.host;
    const path = window.location.pathname;
    const title = document.title.toLowerCase();

    if (host.includes('linkedin.com')) {
        // Experience detection
        const hasExpSection = !!document.getElementById('experience') || !!document.querySelector('[id*="experience"]') || !!findLinkedInExperienceLink();
        const pathIsProfile = path.includes('/in/') || path.includes('/details/experience/');
        if (hasExpSection || pathIsProfile) return 'profile';

        // Job detection
        const hasJobContent = !!document.querySelector('.jobs-description') || !!document.querySelector('.job-view-layout');
        const titleIsJob = title.includes('job') && (title.includes('view') || title.includes('|'));
        const pathIsJob = path.includes('/jobs/') || path.includes('/view/');
        if (hasJobContent || (titleIsJob && pathIsJob)) return 'job';
    }
    
    // Default fallback based on common patterns if not LinkedIn
    if (path.includes('job') || title.includes('job')) return 'job';
    if (path.includes('profile') || path.includes('resume')) return 'profile';
    
    return 'generic';
};

const clearWidgetState = (widget) => {
    widget.dataset.assessment = "";
    widget.dataset.jobData = "";
    widget.style.borderLeft = "none";
    widget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.6)";

    const overlay = document.getElementById('tablah-overlay');
    if (overlay) overlay.remove();

    const textEl = document.getElementById('tablah-analyze-text');
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
    
    const pageType = getPageType();
    const showExperiences = pageType === 'profile';
    const showJobs = pageType === 'job' || pageType === 'generic';

    widget.innerHTML = `
        <style>
            #tablah-widget {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 10000;
                background: #0f172a;
                color: white;
                padding: 6px;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6);
                font-family: 'Inter', -apple-system, sans-serif;
                border: 1px solid rgba(255,255,255,0.15);
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 8px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #tablah-selection-badge {
                padding: 4px 10px;
                background: #38bdf8;
                color: #0f172a;
                font-size: 10px;
                font-weight: 800;
                text-transform: uppercase;
                border-radius: 20px;
                margin-bottom: -4px;
                opacity: 0;
                transform: translateY(10px);
                transition: all 0.3s ease;
                pointer-events: none;
            }
            #tablah-selection-badge.visible {
                opacity: 1;
                transform: translateY(0);
            }
            .tablah-toolbar-content {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .tablah-action-btn {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-radius: 8px;
                cursor: pointer;
                transition: background 0.2s;
                white-space: nowrap;
            }
            .tablah-action-btn:hover {
                background: rgba(255,255,255,0.1);
            }
            .tablah-action-btn img {
                width: 20px;
                height: 20px;
                border-radius: 4px;
            }
            .tablah-action-btn span {
                font-size: 14px;
                font-weight: 600;
            }
            .tablah-divider {
                width: 1px;
                height: 24px;
                background: rgba(255,255,255,0.1);
                margin: 0 4px;
            }
            .tablah-icon-only {
                padding: 8px;
            }
        </style>
        <div id="tablah-selection-badge">Using Selection</div>
        <div class="tablah-toolbar-content">
            ${showJobs ? `
            <div class="tablah-action-btn" id="tablah-btn-analyze" title="Analyze Fit">
                <img src="${chrome.runtime.getURL('/icons/icon48.png')}">
                <span id="tablah-analyze-text">Analyze Fit</span>
            </div>
            <div class="tablah-divider"></div>
            <div class="tablah-action-btn tablah-icon-only" id="tablah-btn-import-job-widget" title="Import Job">
                <img src="${chrome.runtime.getURL('/icons/icon48.png')}" style="filter: grayscale(1) brightness(1.5);">
            </div>
            ` : ''}
            ${showExperiences ? `
            <div class="tablah-action-btn tablah-icon-only" id="tablah-btn-import-exp-widget" title="Import Experiences">
                <img src="${chrome.runtime.getURL('/icons/icon48.png')}" style="filter: hue-rotate(180deg) brightness(1.2);">
            </div>
            ` : ''}
        </div>
    `;

    document.body.appendChild(widget);

    // Click handler for Analyze Fit
    const analyzeBtn = document.getElementById('tablah-btn-analyze');
    if (analyzeBtn) {
        analyzeBtn.onclick = (e) => {
            e.stopPropagation();
            if (widget.dataset.authRequired === "true") {
                window.open(CONFIG.APP_URL, '_blank');
                return;
            }
            const assessment = widget.dataset.assessment ? JSON.parse(widget.dataset.assessment) : null;
            if (assessment) {
                showOverlay(assessment);
            } else {
                showQuickScore(widget, true); 
            }
        };
    }

    // Click handler for Import Job
    const importJobBtn = document.getElementById('tablah-btn-import-job-widget');
    if (importJobBtn) {
        importJobBtn.onclick = async (e) => {
            e.stopPropagation();
            const text = getUniversalRawText(true);
            if (text) {
                chrome.runtime.sendMessage({ 
                    action: "autoImport", 
                    type: "jobs", 
                    text,
                    source: window.location.host,
                    link: window.location.href
                });
            }
        };
    }

    // Click handler for Import Experiences
    const importExpBtn = document.getElementById('tablah-btn-import-exp-widget');
    if (importExpBtn) {
        importExpBtn.onclick = async (e) => {
            e.stopPropagation();
            
            // Re-use the existing LinkedIn redirection/import logic
            const linkedInLink = findLinkedInExperienceLink();
            const isAlreadyDetailed = window.location.pathname.includes('/details/experience/');

            if (linkedInLink && !isAlreadyDetailed) {
                chrome.storage.local.set({ tablah_pending_import: 'experiences' }).then(() => {
                    if (linkedInLink.href) window.location.href = linkedInLink.href;
                    else linkedInLink.click();
                });
            } else {
                const text = getUniversalRawText(true);
                if (text) {
                    chrome.runtime.sendMessage({ 
                        action: "autoImport", 
                        type: "experiences", 
                        text,
                        source: window.location.host,
                        link: window.location.href
                    });
                }
            }
        };
    }

    // Selection Listener for Badge
    const updateSelectionBadge = () => {
        const badge = document.getElementById('tablah-selection-badge');
        if (!badge) return;
        const sel = window.getSelection().toString().trim();
        if (sel.length > 100) {
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    };
    document.addEventListener('selectionchange', updateSelectionBadge);
    updateSelectionBadge();
};

const showOverlay = (assessment, originalRawText = null) => {
    let overlay = document.getElementById('tablah-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'tablah-overlay';
    // ... animation styles ...
    overlay.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 24px;
        width: 480px;
        max-height: 80vh;
        overflow-y: auto;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 16px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.7);
        z-index: 10001;
        padding: 24px;
        font-family: 'Inter', system-ui, sans-serif;
        border: 1px solid rgba(255,255,255,0.1);
        animation: tablah-slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
    `;

    if (originalRawText) {
        overlay.dataset.rawText = originalRawText;
    }

    if (assessment.loading) {
        overlay.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; gap: 16px;">
                <div class="tablah-spinner" style="width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #38bdf8; border-radius: 50%; animation: tablah-spin 1s linear infinite;"></div>
                <div style="font-weight: 600; color: #94a3b8;">Analyzing Job with Tablah AI...</div>
            </div>
            <style>
                @keyframes tablah-spin { to { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(overlay);
        return;
    }

    if (assessment.error) {
        overlay.innerHTML = `
             <div class="tablah-title">
                <span>Issue Detected</span>
                <span class="tablah-close">&times;</span>
            </div>
            <div style="color: #f87171; font-size: 14px; line-height: 1.5; margin-top: 8px;">${assessment.error}</div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.tablah-close').onclick = () => overlay.remove();
        return;
    }

    overlay.innerHTML = `
        <style>
            @keyframes tablah-slideIn { from { opacity: 0; transform: translateY(20px); } }
            .tablah-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; display: flex; justify-content: space-between; }
            .tablah-score { color: #38bdf8; }
            .tablah-section { margin-bottom: 15px; }
            .tablah-heading { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; margin-bottom: 5px; font-weight: 600; }
            .tablah-body { font-size: 13px; line-height: 1.5; color: #cbd5e1; }
            .tablah-close { cursor: pointer; color: #94a3b8; font-size: 20px; }
            .tablah-btn { background: #2563eb; color: white; border: none; padding: 10px; border-radius: 6px; width: 100%; margin-top: 10px; font-weight: 600; cursor: pointer; }
        </style>
        <div class="tablah-title">
            <span>${assessment.job_title || 'AI Assessment'}</span>
            <span class="tablah-close">&times;</span>
        </div>
        <div class="tablah-section">
            <div class="tablah-heading">Company</div>
            <div class="tablah-body" style="font-weight: 600;">${assessment.job_company || 'Unknown Company'} (${assessment.job_location || 'Unknown Location'})</div>
        </div>
        <div class="tablah-section">
            <div class="tablah-heading">Fit Score</div>
            <div class="tablah-body tablah-score" style="font-size: 24px; font-weight: 800;">${assessment.score}%</div>
        </div>
        <div class="tablah-section">
            <div class="tablah-heading">Strengths</div>
            <div class="tablah-body">${assessment.strengths}</div>
        </div>
        <div class="tablah-section">
            <div class="tablah-heading">Gap Analysis</div>
            <div class="tablah-body">${assessment.weaknesses}</div>
        </div>
        <button class="tablah-btn" id="tablah-import-btn">Import to Tablah</button>
    `;

    overlay.querySelector('.tablah-close').onclick = () => overlay.remove();
    overlay.querySelector('#tablah-import-btn').onclick = async (e) => {
        const btn = e.target;
        const raw_text = overlay.dataset.rawText || getUniversalRawText(true);
        
        if (!raw_text) {
            btn.innerText = 'Text Not Found';
            btn.disabled = false;
            return;
        }

        btn.innerText = 'Opening Magic Import...';
        btn.disabled = true;

        // Trigger the "Magic Import" workflow via the service worker (Draft -> Tab Redirect)
        chrome.runtime.sendMessage({ 
            action: "autoImport", 
            type: "jobs", 
            text: raw_text 
        });

        // Close overlay as the user is being redirected
        setTimeout(() => overlay.remove(), 1000);
    };

    document.body.appendChild(overlay);
};

const shouldShowWidget = async () => {
    const host = window.location.hostname;
    const path = window.location.pathname.toLowerCase();
    
    // Generic Job Site Detection
    const jobKeywords = ['/jobs', '/career', '/vacancy', '/recruitment', '/apply', '/postings'];
    const isJobPage = jobKeywords.some(k => path.includes(k)) || 
                      document.querySelector('meta[property*="job"]') ||
                      document.querySelector('script[type="application/ld+json"]:contains("JobPosting")');

    if (isJobPage) return true;

    // User whitelist
    const data = await chrome.storage.local.get(['enabled_sites']);
    const enabledSites = data.enabled_sites || [];
    return enabledSites.includes(host);
};

// URL mutation observer to detect job page changes on LinkedIn
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
// Initial run disabled as per user request
// shouldShowWidget().then(show => {
//     if (show) widgetTimeout = setTimeout(createWidget, 2000);
// });

const getProfileRawText = () => {
    return getUniversalRawText(true); // Share the same generic logic
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape") {
        const linkedInLink = findLinkedInExperienceLink();
        const isAlreadyDetailed = window.location.pathname.includes('/details/experience/');

        if (linkedInLink && !isAlreadyDetailed) {
            console.log("Tablah: Redirecting to full experience list for better data...");
            chrome.storage.local.set({ tablah_pending_import: 'experiences' }).then(() => {
                // Short delay to ensure storage is flushed
                setTimeout(() => {
                    if (linkedInLink.href) {
                        window.location.href = linkedInLink.href;
                    } else {
                        linkedInLink.click();
                    }
                }, 100);
            });
            sendResponse({ status: "redirecting" });
            return true;
        }

        const text = getUniversalRawText(request.useContext || false);
        sendResponse({ 
            text, 
            source: window.location.host, 
            link: window.location.href 
        });
    } else if (request.action === "analyzeSelected") {
        const widget = document.getElementById('tablah-widget');
        showQuickScore(widget, request.useContext || false);
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
                // if (!document.getElementById('tablah-widget')) {
                //     createWidget();
                // }
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
// Auto-Resume LinkedIn Import
(async () => {
    const data = await chrome.storage.local.get(['tablah_pending_import']);
    const isDetailed = window.location.pathname.includes('/details/experience/');
    
    if (data.tablah_pending_import === 'experiences' && isDetailed) {
        await chrome.storage.local.remove('tablah_pending_import');
        console.log("Tablah: Resuming auto-import on details page...");
        
        // Wait for LinkedIn to load content (DOM can be slow)
        setTimeout(async () => {
            const text = getUniversalRawText(true);
            if (text && text.length > 300) {
                console.log("Tablah: Successfully harvested experience text. Sending to Magic Import...");
                chrome.runtime.sendMessage({ 
                    action: "autoImport", 
                    type: "experiences", 
                    text,
                    source: window.location.host,
                    link: window.location.href
                });
            } else {
                console.warn("Tablah: Auto-import failed. Content too short or container not found.", { length: text ? text.length : 0 });
            }
        }, 3500);
    }
})();

// SPA Navigation Support for LinkedIn
window.addEventListener('popstate', () => {
    const w = document.getElementById('tablah-widget');
    if (w) w.remove();
    // createWidget();
});
