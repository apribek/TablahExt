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
        contexts: ["all"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "analyze-with-tablah") {
        chrome.tabs.sendMessage(tab.id, { action: "analyzeSelected", useContext: true });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'apiFetch') {
        (async () => {
            const token = await getFreshAuthToken();
            const { url, options } = request;

            // Inject the fresh token into the headers
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
    }
});
