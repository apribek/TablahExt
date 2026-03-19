const API_BASE = CONFIG.API_BASE;
const APP_URL = CONFIG.APP_URL;

const generateHash = async (text) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

let jobData = null;
let authToken = null;
let currentAssessment = null;

const checkAuth = async () => {
    // Try to get token from storage first
    const data = await chrome.storage.local.get(['clerk_token']);
    if (data.clerk_token) {
        authToken = data.clerk_token;
        return true;
    }

    // In a real scenario, we'd look for the cookie from the main app's domain
    try {
        const cookies = await chrome.cookies.getAll({ domain: "localhost" });
        const sessionCookie = cookies.find(c => c.name.startsWith('__client_unv_')); // Clerk cookie pattern
        if (sessionCookie) {
            // Simplified for scratch/demo: If we have the cookie, we consider it authenticated
            // In a real app, we'd exchange session for a JWT token
            // For now, let's suggest the user log in if the token is not explicit
        }
    } catch (e) {
        console.error("Cookie access error:", e);
    }
    
    return !!authToken;
};

const showView = (viewId) => {
    document.getElementById('main-view').style.display = viewId === 'main' ? 'block' : 'none';
    document.getElementById('auth-view').style.display = viewId === 'auth' ? 'block' : 'none';
};

const showError = (msg) => {
    const errorEl = document.getElementById('error');
    errorEl.innerText = msg;
    errorEl.style.display = 'block';
    setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
};

const scrapeJob = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "scrapeJob" });
        if (response) {
            jobData = response;
            document.getElementById('job-title').innerText = "Scanning page...";
            document.getElementById('job-company').innerText = "Detecting job details...";
        }
    } catch (e) {
        console.error("Scraping error:", e);
        showError("Could not read job details. Are you on a job page?");
    }
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

const assessJob = async () => {
    if (!jobData || !jobData.description) {
        showError("No job description found to analyze.");
        return;
    }

    document.getElementById('loading').style.display = 'block';
    document.getElementById('assessment-result').style.display = 'none';
    document.getElementById('job-info-card').style.opacity = '0.5';
    
    const assessBtn = document.getElementById('btn-assess');
    const importBtn = document.getElementById('btn-import');
    assessBtn.disabled = true;
    importBtn.disabled = true;
    assessBtn.innerText = "Analyzing...";

    try {
        const assessment = await apiFetch(`${API_BASE}/assessments/quick`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ raw_text: jobData.description })
        });

        currentAssessment = assessment;

        // Update UI with AI-parsed metadata
        if (assessment.job_title) {
            document.getElementById('job-title').innerText = assessment.job_title;
        }
        if (assessment.job_company) {
            document.getElementById('job-company').innerText = assessment.job_company;
        }

        document.getElementById('score-value').innerText = `${assessment.score}%`;
        document.getElementById('strengths-text').innerText = assessment.strengths;
        document.getElementById('weaknesses-text').innerText = assessment.weaknesses;
        
        document.getElementById('assessment-result').style.display = 'block';
        document.getElementById('assessment-details').style.display = 'block';
        document.getElementById('btn-assess').innerText = "Re-Analyze";
    } catch (e) {
        showError(e.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('job-info-card').style.opacity = '1';
        const assessBtn = document.getElementById('btn-assess');
        const importBtn = document.getElementById('btn-import');
        assessBtn.disabled = false;
        importBtn.disabled = false;
        assessBtn.innerText = "Re-Analyze Fit";
    }
};

const importJob = async () => {
    if (!jobData) {
        showError("No job data to import.");
        return;
    }

    const btn = document.getElementById('btn-import');
    btn.disabled = true;
    btn.innerText = "Importing...";

    try {
        // No need to re-parse, we have currentAssessment
        const description = currentAssessment?.job_description || jobData.description;
        const job_hash = await generateHash(description + (jobData.link || ""));
        
        await apiFetch(`${API_BASE}/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                title: currentAssessment?.job_title || jobData.title || "Unknown Job",
                company: currentAssessment?.job_company || jobData.company || "Unknown Company",
                location: currentAssessment?.job_location || "",
                description: description,
                source: jobData.source,
                link: jobData.link,
                status: "NEW",
                is_manual: false,
                job_hash: job_hash
            })
        });

        btn.innerText = "Imported!";
        btn.classList.replace('btn-outline', 'btn-primary');
        btn.style.backgroundColor = 'var(--success)';
        btn.style.border = 'none';
        
    } catch (e) {
        showError(e.message);
        btn.innerText = "Import Job";
        btn.disabled = false;
    }
};

// Listeners
document.getElementById('btn-assess').addEventListener('click', assessJob);
document.getElementById('btn-import').addEventListener('click', importJob);
document.getElementById('btn-login').addEventListener('click', () => {
    chrome.tabs.create({ url: APP_URL });
});

// Init
(async () => {
    const isAuthenticated = await checkAuth();
    
    // Get current tab info for site enablement
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        try {
            const host = new URL(tab.url).hostname;
            document.getElementById('site-host').innerText = host;

            const data = await chrome.storage.local.get(['enabled_sites']);
            const enabledSites = data.enabled_sites || [];
            const defaultSites = ['linkedin.com', 'indeed.com'];
            const isDefault = defaultSites.some(s => host.includes(s));
            
            const toggle = document.getElementById('site-toggle');
            toggle.checked = isDefault || enabledSites.includes(host);
            if (isDefault) {
                toggle.disabled = true;
                document.getElementById('site-host').innerText += " (Enabled by default)";
            }

            toggle.onchange = async () => {
                const results = await chrome.storage.local.get(['enabled_sites']);
                let current = results.enabled_sites || [];
                if (toggle.checked) {
                    if (!current.includes(host)) current.push(host);
                } else {
                    current = current.filter(s => s !== host);
                }
                await chrome.storage.local.set({ enabled_sites: current });
            };
        } catch (e) {
            console.warn("Could not determine hostname for site toggle", e);
        }
    }

    if (!isAuthenticated) {
        showView('auth');
    } else {
        showView('main');
        await scrapeJob();
        
        // Auto-trigger assessment if we have job data
        if (jobData && jobData.description) {
            assessJob();
        }
    }
})();

// Allow setting token via console for power users
window.setToken = (token) => {
    chrome.storage.local.set({ clerk_token: token }, () => {
        location.reload();
    });
};
