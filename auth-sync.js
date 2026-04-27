// Auth-Sync Script for Tablah
// Captures the Clerk session token from the web app and saves it to extension storage.

const syncClerkToken = async () => {
    const storedToken = localStorage.getItem('clerk_token');
    if (storedToken) {
        chrome.storage.local.set({ clerk_token: storedToken });
        return;
    }

    const cookies = document.cookie.split('; ');
    const sessionCookie = cookies.find(row => row.startsWith('__session='));
    if (sessionCookie) {
        const token = sessionCookie.split('=')[1];
        chrome.storage.local.set({ clerk_token: token });
    }
};

// Periodic sync or on certain events
setTimeout(syncClerkToken, 2000);
window.addEventListener('load', syncClerkToken);
