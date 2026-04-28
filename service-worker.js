importScripts('config.js');

const normalizeUrl = (url) => {
    try { const u = new URL(url); return u.origin + u.pathname; }
    catch (_) { return url; }
};

const getFreshAuthToken = async () => {
    try {
        const cookies = await chrome.cookies.getAll({ domain: CONFIG.COOKIE_DOMAIN }); 
        const sessionCookie = cookies.find(c => c.name === '__session' || c.name.startsWith('__client_unv_'));
        if (sessionCookie) {
             // Store it for quick access by content scripts
             await chrome.storage.local.set({ clerk_token: sessionCookie.value });
             return sessionCookie.value;
        }
    } catch (e) {
        console.error("Service Worker: Failed to retrieve fresh auth cookie.", e);
    }
    const data = await chrome.storage.local.get(['clerk_token']);
    return data.clerk_token;
};

const fetchAndCacheFeatures = async () => {
    const token = await getFreshAuthToken();
    if (!token) return null;
    try {
        const response = await fetch(`${CONFIG.API_BASE}/candidates/me/features`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const data = await response.json();
        await chrome.storage.local.set({ user_features: data.features });
        return data.features;
    } catch (_) {
        return null;
    }
};

const applyFeatureVisibility = async () => {
    const stored = await chrome.storage.local.get(['user_features']);
    const features = stored.user_features || [];
    chrome.contextMenus.update('import-job-tablah', { visible: features.includes('discovery_job_import_magic') });
    chrome.contextMenus.update('import-profile-tablah', { visible: features.includes('profile_experience_import_magic') });
};

const registerContextMenus = () => {
    chrome.contextMenus.removeAll(async () => {
        chrome.contextMenus.create({
            id: "score-with-tablah",
            title: "Score Job Fit with Tablah",
            contexts: ["page", "selection"]
        });
        chrome.contextMenus.create({
            id: "chat-job-tablah",
            title: "Chat about this job with Tablah",
            contexts: ["page", "selection"]
        });
        chrome.contextMenus.create({
            id: "import-profile-tablah",
            title: "Import Experiences with Tablah",
            contexts: ["page", "selection"],
            visible: false
        });
        chrome.contextMenus.create({
            id: "import-job-tablah",
            title: "Import Job with Tablah",
            contexts: ["page", "selection"],
            visible: false
        });
        await fetchAndCacheFeatures();
        await applyFeatureVisibility();
    });
};

chrome.runtime.onInstalled.addListener(registerContextMenus);
chrome.runtime.onStartup.addListener(registerContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "score-with-tablah") {
        chrome.tabs.sendMessage(tab.id, { action: "analyzeSelected", useContext: true });
    } else if (info.menuItemId === "chat-job-tablah") {
        const tabId = tab.id;
        const tabUrl = tab.url;
        const tabTitle = tab.title;
        // open() must be called synchronously (user gesture context)
        chrome.sidePanel.open({ tabId });
        // Everything after this can be async
        await chrome.storage.local.remove(['current_chat_url']);
        await chrome.storage.local.set({ active_chat_tab_id: tabId });
        const normalizedUrl = normalizeUrl(tabUrl);
        const existing = await chrome.storage.local.get(['chat_sessions']);
        const sessions = existing.chat_sessions || {};
        const prev = sessions[normalizedUrl];
        if (prev && prev.rawJd) {
            // Good existing session — restore without re-scraping
            await chrome.storage.local.set({ current_chat_url: normalizedUrl });
        } else {
            // No session, or previous scrape returned null — try fresh scrape
            try {
                const response = await chrome.tabs.sendMessage(tabId, { action: "scrape", useContext: true });
                sessions[normalizedUrl] = {
                    rawJd: response && response.text ? response.text : null,
                    title: tabTitle,
                    conversationId: prev ? prev.conversationId : null,
                    chatToken: prev ? prev.chatToken : crypto.randomUUID(),
                    messages: prev ? prev.messages : [],
                    lastAccessed: Date.now()
                };
            } catch (e) {
                console.warn("TablahExt: scrape failed.", e.message);
                sessions[normalizedUrl] = {
                    rawJd: null, title: tabTitle,
                    conversationId: prev ? prev.conversationId : null,
                    chatToken: prev ? prev.chatToken : crypto.randomUUID(),
                    messages: prev ? prev.messages : [],
                    lastAccessed: Date.now()
                };
            }
            await chrome.storage.local.set({ chat_sessions: sessions, current_chat_url: normalizedUrl });
        }
    } else if (info.menuItemId === "import-profile-tablah") {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true });
        if (response && response.text) {
            await saveDraftAndRedirect(response.text, 'experiences', tab.id);
        }
    } else if (info.menuItemId === "import-job-tablah") {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true });
        if (response && response.text) {
            const normalizedUrl = normalizeUrl(tab.url);
            const stored = await chrome.storage.local.get(['chat_sessions']);
            const chatToken = (stored.chat_sessions || {})[normalizedUrl]?.chatToken || null;
            await ingestJob(response.text, tab.url, tab.id, chatToken);
        }
    }
});

const openAppTab = async (url) => {
    const tabs = await chrome.tabs.query({ url: `${CONFIG.APP_URL}/*` });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url, active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url });
    }
};

const saveDraftAndRedirect = async (text, type, _tabId) => {
    try {
        const token = await getFreshAuthToken();
        const response = await fetch(`${CONFIG.API_BASE}${CONFIG.DRAFT_API_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ raw_text: text })
        });
        
        if (response.ok) {
            const draft = await response.json();
            const importUrl = `${CONFIG.APP_URL}/en/dashboard/candidate/${type}?draftId=${draft.draft_id}`;
            await openAppTab(importUrl);
        } else {
            console.error("Draft saving failed:", await response.text());
        }
    } catch (e) {
        console.error("Error in saveDraftAndRedirect:", e);
    }
};

const ingestJob = async (rawText, pageUrl, _tabId, chatToken = null) => {
    try {
        const token = await getFreshAuthToken();
        const response = await fetch(`${CONFIG.API_BASE}${CONFIG.INGEST_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ raw_text: rawText, link: pageUrl, chat_token: chatToken })
        });
        if (response.ok) {
            const data = await response.json();
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Job imported',
                message: `${data.job_title} at ${data.job_company}`
            });
            // Store job_id in the chat session for this URL so chat can link it
            const normalizedUrl = normalizeUrl(pageUrl);
            const stored = await chrome.storage.local.get(['chat_sessions']);
            const sessions = stored.chat_sessions || {};
            if (sessions[normalizedUrl]) {
                sessions[normalizedUrl].jobId = data.job_id;
                await chrome.storage.local.set({ chat_sessions: sessions });
            }
            return data;
        } else {
            console.error("Ingest failed:", await response.text());
        }
    } catch (e) {
        console.error("Error in ingestJob:", e);
    }
    return null;
};

const handleUrlChanged = async (sender, url) => {
    const data = await chrome.storage.local.get(['active_chat_tab_id', 'chat_sessions']);
    if (data.active_chat_tab_id !== sender.tab.id) return;

    const normalized = normalizeUrl(url);
    const sessions = data.chat_sessions || {};

    if (sessions[normalized] && sessions[normalized].rawJd) {
        // Good existing session — restore without re-scraping
        await chrome.storage.local.set({ current_chat_url: normalized });
        return;
    }

    // New URL or prior scrape failed — signal panel to show loading, then scrape
    await chrome.storage.local.set({ current_chat_url: normalized });
    await new Promise(r => setTimeout(r, 1500)); // Let SPA content settle

    try {
        const response = await chrome.tabs.sendMessage(sender.tab.id, { action: 'scrape', useContext: true });
        const fresh = await chrome.storage.local.get(['chat_sessions']);
        const s = fresh.chat_sessions || {};
        const prior = s[normalized];
        s[normalized] = {
            rawJd: response && response.text ? response.text : null,
            title: sender.tab.title || '',
            conversationId: prior ? prior.conversationId : null,
            messages: prior ? prior.messages : [],
            lastAccessed: Date.now()
        };
        await chrome.storage.local.set({ chat_sessions: s });
    } catch (e) {
        const fresh = await chrome.storage.local.get(['chat_sessions']);
        const s = fresh.chat_sessions || {};
        const prior = s[normalized];
        s[normalized] = {
            rawJd: null, title: '',
            conversationId: prior ? prior.conversationId : null,
            messages: prior ? prior.messages : [],
            lastAccessed: Date.now()
        };
        await chrome.storage.local.set({ chat_sessions: s });
    }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'apiFetch') {
        (async () => {
            const token = await getFreshAuthToken();
            const { url, options } = request;

            if (token && options.headers) {
                options.headers['Authorization'] = `Bearer ${token}`;
            }

            try {
                const response = await fetch(url, options);
                const data = await response.json().catch(() => ({}));

                if (response.ok) {
                    sendResponse({ ok: true, data });
                } else {
                    const errorMsg = data.detail || `Server error: ${response.status}`;
                    sendResponse({ ok: false, status: response.status, error: errorMsg });
                }
            } catch (error) {
                console.error("Service worker fetch error:", error);
                sendResponse({ ok: false, error: error.message });
            }
        })();
        return true; 
    } else if (request.action === 'urlChanged') {
        handleUrlChanged(sender, request.url);
        // fire-and-forget, no response
    } else if (request.action === 'autoImport') {
        saveDraftAndRedirect(request.text, request.type, sender.tab.id);
        return true;
    } else if (request.action === 'silentImport') {
        saveDraftSilent(request.text, request.type);
        sendResponse({status: "queued"});
        return true;
    } else if (request.action === 'processDetailTabs') {
        startDetailTabQueue(request.links, sender.tab.id);
    } else if (request.action === 'detailTabDone') {
        chrome.tabs.remove(sender.tab.id);
        setTimeout(() => processNextDetailTab(), 3000); // 3 seconds stealth gap
    }
});

const saveDraftSilent = async (text, _type) => {
    try {
        const token = await getFreshAuthToken();
        await fetch(`${CONFIG.API_BASE}${CONFIG.DRAFT_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ raw_text: text })
        });
        // We just save it silently to DB, the sweep keeps running.
    } catch (e) {
        console.error("Error in saveDraftSilent:", e);
    }
};

let detailQueue = [];
let sweepMainTabId = null;

const startDetailTabQueue = (links, mainTabId) => {
    detailQueue = links;
    sweepMainTabId = mainTabId;
    processNextDetailTab();
};

const processNextDetailTab = () => {
    if (detailQueue.length > 0) {
        const nextUrl = detailQueue.shift();
        chrome.storage.local.set({ activeDetailScrapeURL: nextUrl }, () => {
            chrome.tabs.create({ url: nextUrl, active: false });
        });
    } else {
        // Queue empty, tell the main tab to paginate
        chrome.tabs.sendMessage(sweepMainTabId, { action: 'detailTabsFinished' });
    }
};
