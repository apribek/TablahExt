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
    // Look for links that contain "/details/experience/"
    const links = Array.from(document.querySelectorAll('a[href*="/details/experience/"]'));
    if (links.length > 0) {
        return links[0];
    }
    
    // Fallback: search by text for "all" and "experience"
    const allLinks = document.querySelectorAll('a, button');
    for (const link of allLinks) {
        const text = (link.innerText || link.getAttribute('aria-label') || "").toLowerCase();
        // Common variants: "Show all experience", "See all experience", "View all experience"
        if ((text.includes('show all') || text.includes('see all') || text.includes('view all')) && 
            text.includes('experience')) {
            return link;
        }
    }
    return null;
};

const getUniversalRawText = (useContext = false) => {
    // Priority 1: Selection (Must be substantial)
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const selectedText = selection.toString().trim();
        if (selectedText.length > 100) {
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
                return el.innerText.trim();
            }
            
            if (['ARTICLE', 'MAIN', 'SECTION'].includes(el.tagName)) {
                 if (textLen > 300) {
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
            return text;
        }
    }

    return null;
};

const scoreColor = (score) =>
    score > 70 ? '#22c55e' : score > 40 ? '#f59e0b' : '#ef4444';

const showScore = async (widget, useContext = false) => {
    if (widget && widget.dataset.loading === "true") return;

    const textEl = widget ? document.getElementById('tablah-analyze-text') : null;
    const iconEl = widget ? document.querySelector('#tablah-btn-analyze img') : null;
    const token = await getAuthToken();

    if (!token) {
        if (textEl) { textEl.innerText = 'Login to Tablah'; widget.dataset.authRequired = "true"; }
        else showOverlay({ error: 'Please login to Tablah to use AI scoring.' });
        return;
    }

    if (widget) {
        widget.dataset.authRequired = "false";
        widget.dataset.loading = "true";
        widget.classList.add('loading');
        if (textEl) textEl.innerText = 'Analyzing...';
        if (iconEl) iconEl.classList.add('tablah-spin');
    } else {
        showOverlay({ loading: true });
    }

    try {
        const raw_text = getUniversalRawText(useContext);
        if (!raw_text) {
            if (textEl) textEl.innerText = 'Select text & retry';
            else showOverlay({ error: 'No content found. Please select the job description and try again.' });
            return;
        }

        // Stage 1: POST with full text
        const result = await apiFetch(`${CONFIG.API_BASE}${CONFIG.SCORE_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text, link: window.location.href })
        });

        if (widget) {
            if (textEl) textEl.innerText = `Fit Score: ${result.score}%`;
            widget.style.borderLeft = `4px solid ${scoreColor(result.score)}`;
            widget.dataset.assessment = JSON.stringify(result);
        }

        showOverlay(result);

        // Stage 2: poll until is_final if the backend is still refining
        if (!result.is_final && result.candidate_job_id) {
            pollScore(result.candidate_job_id, widget);
        }

    } catch (e) {
        console.error("Score error:", e);
        if (textEl) textEl.innerText = 'Retry Analysis';
        else showOverlay({ error: 'Scoring failed. Please check your connection and try again.' });
    } finally {
        if (widget) {
            widget.dataset.loading = "false";
            widget.classList.remove('loading');
            if (iconEl) iconEl.classList.remove('tablah-spin');
        }
    }
};

const pollScore = async (candidateJobId, widget, attempts = 0) => {
    const MAX_ATTEMPTS = 10;
    const INTERVAL_MS = 4000;

    if (attempts >= MAX_ATTEMPTS) return;

    await new Promise(r => setTimeout(r, INTERVAL_MS));

    try {
        const result = await apiFetch(
            `${CONFIG.API_BASE}${CONFIG.SCORE_API_URL}/${candidateJobId}`,
            { method: 'GET', headers: { 'Content-Type': 'application/json' } }
        );

        // Update overlay score in place if it's still open
        const overlay = document.getElementById('tablah-overlay');
        if (overlay && overlay.dataset.candidateJobId === candidateJobId) {
            const scoreEl = overlay.querySelector('#tablah-score-value');
            const badgeEl = overlay.querySelector('#tablah-refining-badge');
            if (scoreEl) {
                scoreEl.innerText = `${result.score}%`;
                scoreEl.style.color = scoreColor(result.score);
            }
            if (badgeEl) {
                if (result.is_final) badgeEl.remove();
                else badgeEl.innerText = 'Refining…';
            }
            updateFacetBars(overlay, result.facet_scores);
        }

        // Update widget border
        if (widget) {
            widget.style.borderLeft = `4px solid ${scoreColor(result.score)}`;
            const textEl = document.getElementById('tablah-analyze-text');
            if (textEl) textEl.innerText = `Fit Score: ${result.score}%`;
            widget.dataset.assessment = JSON.stringify(result);
        }

        if (!result.is_final) {
            pollScore(candidateJobId, widget, attempts + 1);
        }
    } catch (e) {
        console.error("Poll error:", e);
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

const FACET_LABELS = {
    skill_score: 'Skills',
    domain_score: 'Domain',
    seniority_score: 'Seniority',
    behavior_score: 'Soft Skills',
};

const updateFacetBars = (overlay, facetScores) => {
    if (!facetScores) return;
    for (const [key] of Object.entries(FACET_LABELS)) {
        const bar = overlay.querySelector(`[data-facet="${key}"] .tablah-bar-fill`);
        const val = overlay.querySelector(`[data-facet="${key}"] .tablah-bar-val`);
        const score = facetScores[key] ?? 0;
        if (bar) bar.style.width = `${score}%`;
        if (val) val.innerText = `${score}%`;
    }
};

const facetBarsHtml = (facetScores) => {
    if (!facetScores) return '';
    const rows = Object.entries(FACET_LABELS).map(([key, label]) => {
        const score = facetScores[key] ?? 0;
        const color = scoreColor(score);
        return `
            <div data-facet="${key}" style="margin-bottom: 6px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:3px;">
                    <span>${label}</span><span class="tablah-bar-val">${score}%</span>
                </div>
                <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:5px;">
                    <div class="tablah-bar-fill" style="width:${score}%; height:100%; border-radius:4px; background:${color}; transition: width 0.5s ease;"></div>
                </div>
            </div>`;
    }).join('');
    return `<div class="tablah-section"><div class="tablah-heading">Facet Breakdown</div>${rows}</div>`;
};

const showOverlay = (result) => {
    let overlay = document.getElementById('tablah-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'tablah-overlay';
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

    if (result.loading) {
        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:16px;">
                <div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:#38bdf8;border-radius:50%;animation:tablah-spin 1s linear infinite;"></div>
                <div style="font-weight:600;color:#94a3b8;">Analyzing Job with Tablah AI…</div>
            </div>
            <style>@keyframes tablah-spin{to{transform:rotate(360deg);}}</style>
        `;
        document.body.appendChild(overlay);
        return;
    }

    if (result.error) {
        overlay.innerHTML = `
            <div class="tablah-title"><span>Issue Detected</span><span class="tablah-close">&times;</span></div>
            <div style="color:#f87171;font-size:14px;line-height:1.5;margin-top:8px;">${result.error}</div>
            <style>.tablah-title{font-size:16px;font-weight:700;margin-bottom:12px;display:flex;justify-content:space-between;}.tablah-close{cursor:pointer;color:#94a3b8;font-size:20px;}</style>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.tablah-close').onclick = () => overlay.remove();
        return;
    }

    if (result.candidate_job_id) overlay.dataset.candidateJobId = result.candidate_job_id;

    const color = scoreColor(result.score);
    const refiningBadge = result.is_final ? '' :
        `<span id="tablah-refining-badge" style="font-size:10px;font-weight:700;text-transform:uppercase;color:#f59e0b;letter-spacing:0.5px;">Refining…</span>`;

    overlay.innerHTML = `
        <style>
            @keyframes tablah-slideIn { from { opacity: 0; transform: translateY(20px); } }
            .tablah-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
            .tablah-section { margin-bottom: 15px; }
            .tablah-heading { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; margin-bottom: 5px; font-weight: 600; }
            .tablah-body { font-size: 13px; line-height: 1.5; color: #cbd5e1; }
            .tablah-close { cursor: pointer; color: #94a3b8; font-size: 20px; flex-shrink: 0; }
            .tablah-btn { background: #2563eb; color: white; border: none; padding: 10px; border-radius: 6px; width: 100%; margin-top: 10px; font-weight: 600; cursor: pointer; font-size: 14px; }
            .tablah-btn:disabled { opacity: 0.5; cursor: default; }
        </style>
        <div class="tablah-title">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${result.job_title || 'AI Score'}</span>
            ${refiningBadge}
            <span class="tablah-close">&times;</span>
        </div>
        <div class="tablah-section">
            <div class="tablah-heading">Company</div>
            <div class="tablah-body" style="font-weight:600;">${result.job_company || '—'}${result.job_location ? ` · ${result.job_location}` : ''}</div>
        </div>
        <div class="tablah-section">
            <div class="tablah-heading">Fit Score</div>
            <div style="display:flex;align-items:baseline;gap:8px;">
                <div id="tablah-score-value" style="font-size:28px;font-weight:800;color:${color};">${result.score}%</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${result.tier_used || ''}</div>
            </div>
        </div>
        ${facetBarsHtml(result.facet_scores)}
        <button class="tablah-btn" id="tablah-import-btn">Save to Pipeline</button>
    `;

    overlay.querySelector('.tablah-close').onclick = () => overlay.remove();
    overlay.querySelector('#tablah-import-btn').onclick = async (e) => {
        const btn = e.target;
        btn.innerText = 'Saving…';
        btn.disabled = true;
        try {
            await apiFetch(
                `${CONFIG.API_BASE}${CONFIG.SCORE_API_URL}/${result.candidate_job_id}/import`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' } }
            );
            btn.innerText = 'Saved to Pipeline ✓';
        } catch (err) {
            console.error('Import error:', err);
            btn.innerText = 'Save Failed — Retry';
            btn.disabled = false;
        }
    };

    document.body.appendChild(overlay);
};

const shouldShowWidget = async () => {
    const host = window.location.hostname;
    const path = window.location.pathname.toLowerCase();
    
    // Generic Job Site Detection
    const jobKeywords = ['/jobs', '/career', '/vacancy', '/recruitment', '/apply', '/postings'];
    const ldJsonHasJobPosting = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                                      .some(s => s.textContent.includes('JobPosting'));
    const isJobPage = jobKeywords.some(k => path.includes(k)) ||
                      !!document.querySelector('meta[property*="job"]') ||
                      ldJsonHasJobPosting;

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
        chrome.runtime.sendMessage({ action: 'urlChanged', url: location.href });
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

// Initial run — show widget on direct page load
shouldShowWidget().then(show => {
    if (show) widgetTimeout = setTimeout(createWidget, 2000);
});

const getProfileRawText = () => {
    return getUniversalRawText(true); // Share the same generic logic
};

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "scrape") {
        const linkedInLink = findLinkedInExperienceLink();
        const isAlreadyDetailed = window.location.pathname.includes('/details/experience/');

        if (linkedInLink && !isAlreadyDetailed) {
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
        showScore(widget, request.useContext || false);
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
        // Wait for LinkedIn to load content (DOM can be slow)
        setTimeout(async () => {
            const text = getUniversalRawText(true);
            if (text && text.length > 300) {
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
    shouldShowWidget().then(show => { if (show) createWidget(); });
});
