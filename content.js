let lastClickedElement = null;
const trackClick = e => {
    lastClickedElement = e.target;
};
document.addEventListener('contextmenu', trackClick, true);
document.addEventListener('click', trackClick, true);

const findLinkedInExperienceLink = () => {
    if (!window.location.host.includes('linkedin.com')) return null;
    const links = Array.from(document.querySelectorAll('a[href*="/details/experience/"]'));
    if (links.length > 0) return links[0];
    
    const allLinks = document.querySelectorAll('a, button');
    for (const link of allLinks) {
        const text = (link.innerText || link.getAttribute('aria-label') || "").toLowerCase();
        if ((text.includes('show all') || text.includes('see all') || text.includes('view all')) && 
            text.includes('experience')) {
            return link;
        }
    }
    return null;
};

const getUniversalRawText = (useContext = false) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const selectedText = selection.toString().trim();
        if (selectedText.length > 100) return selectedText;
    }

    if (useContext && lastClickedElement) {
        let el = lastClickedElement.nodeType === 3 ? lastClickedElement.parentElement : lastClickedElement;
        while (el && el.parentElement && el.tagName !== 'BODY') {
            const rect = el.getBoundingClientRect();
            const textLen = el.innerText.trim().length;
            if (rect.width > window.innerWidth * 0.4 && textLen > 400 && textLen < 20000) return el.innerText.trim();
            if (['ARTICLE', 'MAIN', 'SECTION'].includes(el.tagName) && textLen > 300) return el.innerText.trim();
            el = el.parentElement;
        }
    }

    const main = document.querySelector('main') || 
                 document.querySelector('article') || 
                 document.querySelector('.scaffold-layout__main') ||
                 document.querySelector('.pv-profile-section');

    if (main) {
        const text = main.innerText.trim();
        if (text.length > 300) return text;
    }
    return null;
};

const showToast = (message, type = 'info') => {
    let container = document.getElementById('tablah-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tablah-toast-container';
        container.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 100000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
        success: '#22c55e',
        error: '#ef4444',
        info: '#2563eb'
    };
    
    toast.style.cssText = `
        background: #0f172a;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-weight: 600;
        border-left: 4px solid ${colors[type] || colors.info};
        pointer-events: auto;
        animation: tablah-toast-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 200px;
    `;
    
    toast.innerHTML = `
        <span>${message}</span>
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes tablah-toast-in {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes tablah-toast-out {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    if (!document.getElementById('tablah-toast-style')) {
        style.id = 'tablah-toast-style';
        document.head.appendChild(style);
    }

    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'tablah-toast-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape") {
        const linkedInLink = findLinkedInExperienceLink();
        const isAlreadyDetailed = window.location.pathname.includes('/details/experience/');

        if (linkedInLink && !isAlreadyDetailed && request.type === 'experiences') {
            chrome.storage.local.set({ tablah_pending_import: 'experiences' }).then(() => {
                setTimeout(() => {
                    if (linkedInLink.href) window.location.href = linkedInLink.href;
                    else linkedInLink.click();
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
    } else if (request.action === "showToast") {
        showToast(request.message, request.type);
    } else if (request.action === "urlChanged") {
        // No-op for now, background handles it
    }
    return true;
});

// Auto-Resume LinkedIn Import
(async () => {
    const data = await chrome.storage.local.get(['tablah_pending_import']);
    const isDetailed = window.location.pathname.includes('/details/experience/');
    
    if (data.tablah_pending_import === 'experiences' && isDetailed) {
        await chrome.storage.local.remove('tablah_pending_import');
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
            }
        }, 3000);
    }
})();

// SPA Navigation Support
let lastUrl = location.href;
const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        chrome.runtime.sendMessage({ action: 'urlChanged', url: location.href });
    }
});
observer.observe(document, { subtree: true, childList: true });
