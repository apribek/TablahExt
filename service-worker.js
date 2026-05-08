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

chrome.contextMenus.onClicked.addListener((info, tab) => {
    try {
        if (info.menuItemId === "score-with-tablah" || info.menuItemId === "chat-job-tablah") {
            const tabId = tab.id;
            const activeTab = info.menuItemId === "score-with-tablah" ? 'score' : 'chat';
            
            // CRITICAL: open() must be called synchronously in the gesture context
            if (typeof chrome.sidePanel.open === 'function') {
                chrome.sidePanel.open({ tabId });
            } else {
                chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Please open the Tablah side panel manually.", type: "info" });
            }

            // Everything after this can be async
            (async () => {
                await chrome.storage.local.set({
                    sidepanel_active_tab: activeTab,
                    score_force_rescore: activeTab === 'score' ? Date.now() : 0,
                });
                await ensureScrapeAndSession(tab, info.selectionText);
            })();
        } else if (info.menuItemId === "import-profile-tablah") {
            (async () => {
                const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true, type: 'experiences' });
                if (response && response.text) {
                    await saveDraftSilent(response.text, 'experiences', tab.id);
                }
            })();
        } else if (info.menuItemId === "import-job-tablah") {
            (async () => {
                const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true });
                if (response && response.text) {
                    await saveJobSilent(response.text, tab.url, tab.id);
                }
            })();
        }
    } catch (e) {
        console.error("Context menu click error:", e);
    }
});

const ensureScrapeAndSession = async (tab, selectionText = null) => {
    const tabId = tab.id;
    const tabUrl = tab.url;
    const tabTitle = tab.title;
    
    await chrome.storage.local.remove(['current_chat_url']);
    await chrome.storage.local.set({ active_chat_tab_id: tabId });
    
    const normalizedUrl = normalizeUrl(tabUrl);
    const existing = await chrome.storage.local.get(['chat_sessions']);
    const sessions = existing.chat_sessions || {};
    const prev = sessions[normalizedUrl];
    
    if (prev && prev.rawJd && !selectionText) {
        await chrome.storage.local.set({ current_chat_url: normalizedUrl });
    } else {
        try {
            const text = (selectionText && selectionText.length > 100 ? selectionText : null)
            || (await chrome.tabs.sendMessage(tabId, { action: "scrape", useContext: true })).text;
            sessions[normalizedUrl] = {
                rawJd: text || null,
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
};

const saveJobSilent = async (rawText, pageUrl, tabId) => {
    try {
        const token = await getFreshAuthToken();
        const response = await fetch(`${CONFIG.API_BASE}${CONFIG.INGEST_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ raw_text: rawText, link: pageUrl })
        });
        if (response.ok) {
            const data = await response.json();
            chrome.tabs.sendMessage(tabId, { action: "showToast", message: `Job imported: ${data.job_title}`, type: "success" });
        } else {
            chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Job import failed.", type: "error" });
        }
    } catch (e) {
        console.error("Error in saveJobSilent:", e);
        chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Connection error.", type: "error" });
    }
};

const saveDraftSilent = async (text, type, tabId) => {
    try {
        const token = await getFreshAuthToken();
        const response = await fetch(`${CONFIG.API_BASE}${CONFIG.DRAFT_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ raw_text: text })
        });
        if (response.ok) {
            chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Profile experiences imported successfully.", type: "success" });
        } else {
            chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Profile import failed.", type: "error" });
        }
    } catch (e) {
        console.error("Error in saveDraftSilent:", e);
        chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Connection error.", type: "error" });
    }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'prepareSidePanel') {
        chrome.tabs.get(request.tabId, (tab) => {
            if (tab) ensureScrapeAndSession(tab);
        });
        return true;
    } else if (request.action === 'apiFetch') {
        (async () => {
            const token = await getFreshAuthToken();
            const { url, options } = request;
            if (token && options.headers) options.headers['Authorization'] = `Bearer ${token}`;
            try {
                const response = await fetch(url, options);
                const data = await response.json().catch(() => ({}));
                if (response.ok) sendResponse({ ok: true, data });
                else sendResponse({ ok: false, status: response.status, error: data.detail || `Server error: ${response.status}` });
            } catch (error) {
                console.error("Service worker fetch error:", error);
                const msg = error.message.includes('Failed to fetch') ? 'Connection error: Backend unreachable' : error.message;
                sendResponse({ ok: false, error: msg });
            }
        })();
        return true; 
    } else if (request.action === 'urlChanged') {
        // Delay scraping to allow SPA content (like LinkedIn) to load
        setTimeout(() => {
            chrome.tabs.get(sender.tab.id, (tab) => {
                if (tab && tab.url === request.url) {
                    ensureScrapeAndSession(tab);
                }
            });
        }, 1500);
    } else if (request.action === 'autoImport') {
        saveDraftSilent(request.text, request.type, sender.tab.id);
        return true;
    } else if (request.action === 'silentImport') {
        if (request.type === 'jobs') {
            saveJobSilent(request.text, request.link, sender.tab.id);
        } else {
            saveDraftSilent(request.text, request.type, sender.tab.id);
        }
        sendResponse({status: "queued"});
        return true;
    }
});
