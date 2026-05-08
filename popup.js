const getAuthToken = async () => {
    const data = await chrome.storage.local.get(['clerk_token']);
    return data.clerk_token;
};

const init = async () => {
    const token = await getAuthToken();
    if (!token) {
        document.getElementById('auth-required').style.display = 'block';
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('btn-login').onclick = () => {
            window.open(CONFIG.APP_URL, '_blank');
        };
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    
    // Check Backend Status
    const featuresData = await chrome.storage.local.get(['user_features']);
    if (!featuresData.user_features) {
        // Try a quick check
        chrome.runtime.sendMessage({ action: 'apiFetch', url: `${CONFIG.API_BASE}/health`, options: { method: 'GET' } }, (res) => {
            if (res && !res.ok && res.error && res.error.includes('unreachable')) {
                const statusEl = document.createElement('div');
                statusEl.style.cssText = 'background: #ef4444; color: white; font-size: 11px; padding: 4px; text-align: center; font-weight: 600;';
                statusEl.textContent = 'Backend Offline';
                document.body.prepend(statusEl);
            }
        });
    }

    const host = new URL(tab.url).hostname;
    
    // Set up site toggle
    const data = await chrome.storage.local.get(['enabled_sites']);
    const enabledSites = data.enabled_sites || [];
    const toggle = document.getElementById('site-toggle');
    toggle.checked = enabledSites.includes(host);
    
    toggle.onchange = async () => {
        const d = await chrome.storage.local.get(['enabled_sites']);
        let sites = d.enabled_sites || [];
        if (toggle.checked) {
            if (!sites.includes(host)) sites.push(host);
        } else {
            sites = sites.filter(s => s !== host);
        }
        await chrome.storage.local.set({ enabled_sites: sites });
    };

    // Actions
    document.getElementById('item-score').onclick = async () => {
        await chrome.storage.local.set({ sidepanel_active_tab: 'score' });
        chrome.sidePanel.open({ tabId: tab.id });
        chrome.runtime.sendMessage({ action: 'prepareSidePanel', tabId: tab.id });
        window.close();
    };

    document.getElementById('item-chat').onclick = async () => {
        await chrome.storage.local.set({ sidepanel_active_tab: 'chat' });
        chrome.sidePanel.open({ tabId: tab.id });
        chrome.runtime.sendMessage({ action: 'prepareSidePanel', tabId: tab.id });
        window.close();
    };

    document.getElementById('item-import-job').onclick = async () => {
        chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true }, (response) => {
            if (response && response.text) {
                chrome.runtime.sendMessage({ 
                    action: "silentImport", 
                    type: "jobs", 
                    text: response.text,
                    source: response.source,
                    link: response.link
                });
                chrome.tabs.sendMessage(tab.id, { action: "showToast", message: "Job importing...", type: "info" });
            }
        });
        window.close();
    };

    document.getElementById('item-import-profile').onclick = async () => {
        chrome.tabs.sendMessage(tab.id, { action: "scrape", useContext: true }, (response) => {
            if (response && response.text) {
                chrome.runtime.sendMessage({ 
                    action: "autoImport", 
                    type: "experiences", 
                    text: response.text,
                    source: response.source,
                    link: response.link
                });
                chrome.tabs.sendMessage(tab.id, { action: "showToast", message: "Importing profile...", type: "info" });
            }
        });
        window.close();
    };
};

document.addEventListener('DOMContentLoaded', init);
