importScripts('config.js');

const getFreshAuthToken = async () => {
    try {
        const cookies = await chrome.cookies.getAll({ domain: CONFIG.COOKIE_DOMAIN }); 
        const sessionCookie = cookies.find(c => c.name === '__session' || c.name.startsWith('__client_unv_'));
        if (sessionCookie) {
             console.log("Service Worker: Found fresh clerk session in cookies.");
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

const registerContextMenus = () => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "score-with-tablah",
            title: "Score Job Fit with Tablah",
            contexts: ["page", "selection"]
        });
        chrome.contextMenus.create({
            id: "import-profile-tablah",
            title: "Import Experiences with Tablah",
            contexts: ["page", "selection"]
        });
        chrome.contextMenus.create({
            id: "import-job-tablah",
            title: "Import Job with Tablah",
            contexts: ["page", "selection"]
        });
    });
};

chrome.runtime.onInstalled.addListener(registerContextMenus);
chrome.runtime.onStartup.addListener(registerContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "score-with-tablah") {
        chrome.tabs.sendMessage(tab.id, { action: "analyzeSelected", useContext: true });
    } else if (info.menuItemId === "import-profile-tablah") {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true });
        if (response && response.text) {
            await saveDraftAndRedirect(response.text, 'experiences', tab.id);
        }
    } else if (info.menuItemId === "import-job-tablah") {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true });
        if (response && response.text) {
            await saveDraftAndRedirect(response.text, 'jobs', tab.id);
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
