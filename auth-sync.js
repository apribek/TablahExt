// Auth-Sync Script for Tablah (localhost:3000)
// This script captures the Clerk session token from the web app and saves it to the extension storage.

const syncClerkToken = async () => {
    // We check for the session cookie or any identifier from Clerk
    // In a real Clerk app, the token is often in __session or accessible via window.Clerk
    
    // Check localStorage (common for PWAs or if the user is logged in)
    const storedToken = localStorage.getItem('clerk_token'); // If the app saves it there
    if (storedToken) {
        chrome.storage.local.set({ clerk_token: storedToken });
        console.log("TablahExt: Sync'd auth token from localStorage");
        return;
    }

    // Try to get __session cookie
    const cookies = document.cookie.split('; ');
    const sessionCookie = cookies.find(row => row.startsWith('__session='));
    if (sessionCookie) {
        const token = sessionCookie.split('=')[1];
        chrome.storage.local.set({ clerk_token: token });
        console.log("TablahExt: Sync'd auth token from cookie");
    }
};

// Periodic sync or on certain events
setTimeout(syncClerkToken, 2000);
window.addEventListener('load', syncClerkToken);
