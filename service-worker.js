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

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "analyze-with-tablah",
        title: "Analyze Fit with Tablah",
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "analyze-with-tablah") {
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

const saveDraftAndRedirect = async (text, type, tabId) => {
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
    }
});
