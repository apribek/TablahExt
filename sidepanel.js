let conversationId = null;
let rawJd = null;
let chatToken = null;
let isWaiting = false;
let currentUrl = null;
let currentTab = 'score';

const TTL_MS = 86_400_000; // 24 hours

const normalizeUrl = (url) => {
    try { const u = new URL(url); return u.origin + u.pathname; }
    catch (_) { return url; }
};

const stripMarkdown = (text) => text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6} /gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-*] /gm, '• ')
    .replace(/^\d+\. /gm, (m) => m)
    .trim();

const SEED_QUESTIONS = [
    "Analyse my fit for this role",
    "Research the company",
    "What salary range should I expect?",
    "What are the key requirements I should prepare for?",
];

const FACET_LABELS = {
    skill_score: 'Skills',
    domain_score: 'Domain',
    seniority_score: 'Seniority',
    behavior_score: 'Soft Skills',
};

const scoreColor = (score) =>
    score > 70 ? '#22c55e' : score > 40 ? '#f59e0b' : '#ef4444';

const apiFetch = (url, options) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'apiFetch', url, options }, response => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (response.ok) resolve(response.data);
        else reject(new Error(response.error || `HTTP ${response.status}`));
    });
});

const showError = (msg) => {
    const bar = document.getElementById('error-bar');
    bar.textContent = msg;
    bar.style.display = 'block';
    setTimeout(() => { bar.style.display = 'none'; }, 10000);
};

// --- Tabs ---
const initTabs = () => {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.onclick = () => {
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        };
    });
};

const switchTab = (tabId) => {
    currentTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `${tabId}-tab`));
    
    if (tabId === 'chat') {
        const input = document.getElementById('msg-input');
        if (input && !input.disabled) input.focus();
    }
    
    chrome.storage.local.set({ sidepanel_active_tab: tabId });
};

// --- Chat Logic ---
const addMessage = (role, text, persist = true) => {
    const list = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;

    if (persist && currentUrl) {
        chrome.storage.local.get(['chat_sessions']).then(data => {
            const sessions = data.chat_sessions || {};
            if (sessions[currentUrl]) {
                sessions[currentUrl].messages = sessions[currentUrl].messages || [];
                sessions[currentUrl].messages.push({ role, text });
                chrome.storage.local.set({ chat_sessions: sessions });
            }
        });
    }

    return div;
};

const addThinking = () => {
    const list = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'msg thinking';
    div.innerHTML = '<div class="dot-anim"><span></span><span></span><span></span></div>';
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
};

const sendMessage = async (text) => {
    if (isWaiting || !text.trim()) return;
    isWaiting = true;

    document.getElementById('send-btn').disabled = true;
    document.getElementById('msg-input').disabled = true;
    document.getElementById('seeds').style.display = 'none';

    addMessage('user', text);
    const thinking = addThinking();

    try {
        const body = {
            type: 'job_search',
            message: text,
            chat_metadata: { raw_jd: rawJd },
        };
        if (conversationId) body.conversation_id = conversationId;
        else if (chatToken) body.chat_anchor_id = chatToken;

        const data = await apiFetch(`${CONFIG.API_BASE}${CONFIG.CHAT_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        conversationId = data.user_message.conversation_id;

        if (currentUrl) {
            chrome.storage.local.get(['chat_sessions']).then(d => {
                const sessions = d.chat_sessions || {};
                if (sessions[currentUrl]) {
                    sessions[currentUrl].conversationId = conversationId;
                    chrome.storage.local.set({ chat_sessions: sessions });
                }
            });
        }

        thinking.remove();
        addMessage('assistant', stripMarkdown(data.assistant_message.content));
    } catch (e) {
        thinking.remove();
        if (e.message.includes('401')) {
            showError('Session expired. Please log in to Tablah again.');
        } else if (e.message.includes('HTTP 5') || e.message.includes('Failed to fetch') || e.message.includes('Connection error')) {
            showBackendError('chat');
        } else {
            showError(e.message);
        }
    } finally {
        isWaiting = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('msg-input').disabled = false;
        document.getElementById('msg-input').focus();
    }
};

const initSeeds = () => {
    const container = document.getElementById('seeds');
    container.innerHTML = '';
    SEED_QUESTIONS.forEach(q => {
        const btn = document.createElement('button');
        btn.className = 'seed-btn';
        btn.textContent = q;
        btn.onclick = () => {
            document.getElementById('msg-input').value = q;
            sendMessage(q);
            document.getElementById('msg-input').value = '';
        };
        container.appendChild(btn);
    });
    container.style.display = 'flex';
};

// --- Score Logic ---
const renderScore = (result) => {
    document.getElementById('score-loading').classList.add('hidden');
    document.getElementById('score-empty').classList.add('hidden');
    document.getElementById('score-view').classList.remove('hidden');

    const scoreEl = document.getElementById('score-value');
    scoreEl.textContent = `${result.score}%`;
    scoreEl.style.color = scoreColor(result.score);

    document.getElementById('score-job-title').textContent = result.job_title || '';
    document.getElementById('score-job-company').textContent = result.job_company || '';
    document.getElementById('score-tier').textContent = result.tier_used || '';

    const badge = document.getElementById('refining-badge');
    if (result.is_final) badge.classList.add('hidden');
    else badge.classList.remove('hidden');

    const facetList = document.getElementById('facet-list');
    facetList.innerHTML = '';
    
    if (result.facet_scores) {
        Object.entries(FACET_LABELS).forEach(([key, label]) => {
            const val = result.facet_scores[key] || 0;
            const div = document.createElement('div');
            div.className = 'facet-item';
            div.innerHTML = `
                <div class="facet-header">
                    <span>${label}</span><span>${val}%</span>
                </div>
                <div class="facet-bar-bg">
                    <div class="facet-bar-fill" style="width: ${val}%; background: ${scoreColor(val)}"></div>
                </div>
            `;
            facetList.appendChild(div);
        });
    }

    document.getElementById('strengths-text').textContent = result.strengths || 'N/A';
    document.getElementById('weaknesses-text').textContent = result.weaknesses || 'N/A';

    const importBtn = document.getElementById('import-job-btn');
    importBtn.disabled = false;
    importBtn.textContent = 'Save to Pipeline';
    importBtn.onclick = () => performImport(result.candidate_job_id);
};

const performImport = async (candidateJobId) => {
    const btn = document.getElementById('import-job-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await apiFetch(`${CONFIG.API_BASE}${CONFIG.SCORE_API_URL}/${candidateJobId}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        btn.textContent = 'Saved ✓';
    } catch (e) {
        console.error('Import error:', e);
        btn.textContent = 'Save Failed';
        btn.disabled = false;
    }
};

const startScoring = async (text, url) => {
    document.getElementById('score-loading').classList.remove('hidden');
    document.getElementById('score-view').classList.add('hidden');
    document.getElementById('score-empty').classList.add('hidden');

    try {
        const result = await apiFetch(`${CONFIG.API_BASE}${CONFIG.SCORE_API_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: text, link: url })
        });

        // Store result in session
        const data = await chrome.storage.local.get(['chat_sessions']);
        const sessions = data.chat_sessions || {};
        const normalized = normalizeUrl(url);
        if (sessions[normalized]) {
            sessions[normalized].assessment = result;
            await chrome.storage.local.set({ chat_sessions: sessions });
        }

        renderScore(result);

        if (!result.is_final && result.candidate_job_id) {
            pollScore(result.candidate_job_id, normalized);
        }
    } catch (e) {
        console.error('Score error:', e);
        document.getElementById('score-loading').classList.add('hidden');
        if (e.message.includes('401')) {
            showError('Session expired. Please log in to Tablah again.');
        } else if (e.message.includes('HTTP 5') || e.message.includes('Failed to fetch') || e.message.includes('Connection error')) {
            document.getElementById('score-error').classList.remove('hidden');
        } else {
            showError('Scoring failed. ' + e.message);
        }
    }
};

const showBackendError = (tabId) => {
    document.getElementById(`${tabId}-loading`).classList.add('hidden');
    document.getElementById(`${tabId}-ui`)?.classList.add('hidden');
    document.getElementById(`${tabId}-view`)?.classList.add('hidden');
    document.getElementById(`${tabId}-error`).classList.remove('hidden');
};

const pollScore = async (candidateJobId, normalizedUrl, attempts = 0) => {
    const MAX_ATTEMPTS = 10;
    const INTERVAL_MS = 4000;
    if (attempts >= MAX_ATTEMPTS) return;

    await new Promise(r => setTimeout(r, INTERVAL_MS));

    try {
        const result = await apiFetch(`${CONFIG.API_BASE}${CONFIG.SCORE_API_URL}/${candidateJobId}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await chrome.storage.local.get(['chat_sessions']);
        const sessions = data.chat_sessions || {};
        if (sessions[normalizedUrl]) {
            sessions[normalizedUrl].assessment = result;
            await chrome.storage.local.set({ chat_sessions: sessions });
        }

        if (currentUrl === normalizedUrl) {
            renderScore(result);
        }

        if (!result.is_final) {
            pollScore(candidateJobId, normalizedUrl, attempts + 1);
        }
    } catch (e) {
        console.error('Poll error:', e);
    }
};

// --- Lifecycle ---
const switchToUrl = async (url) => {
    currentUrl = normalizeUrl(url);
    conversationId = null;
    rawJd = null;
    chatToken = null;
    isWaiting = false;

    // Clear UI
    document.getElementById('messages').innerHTML = '';
    document.getElementById('seeds').innerHTML = '';
    document.getElementById('score-view').classList.add('hidden');
    document.getElementById('score-loading').classList.remove('hidden');
    document.getElementById('chat-ui').classList.add('hidden');
    document.getElementById('chat-loading').classList.remove('hidden');
    document.getElementById('score-empty').classList.add('hidden');
    document.getElementById('chat-empty').classList.add('hidden');

    const data = await chrome.storage.local.get(['chat_sessions']);
    const sessions = data.chat_sessions || {};
    const session = sessions[currentUrl];

    if (!session) {
        // Wait for session to be created by background scrape
        return;
    }

    // Extend TTL
    session.lastAccessed = Date.now();
    await chrome.storage.local.set({ chat_sessions: sessions });

    if (!session.rawJd) {
        document.getElementById('score-loading').classList.add('hidden');
        document.getElementById('chat-loading').classList.add('hidden');
        document.getElementById('score-empty').classList.remove('hidden');
        document.getElementById('chat-empty').classList.remove('hidden');
        document.getElementById('job-banner').style.display = 'none';
        return;
    }

    rawJd = session.rawJd;
    conversationId = session.conversationId || null;
    chatToken = session.chatToken || null;

    // Update Banner
    try {
        const display = session.title
            ? session.title.slice(0, 60)
            : new URL(url).hostname.replace('www.', '');
        document.getElementById('job-source').textContent = display;
        document.getElementById('job-banner').style.display = 'block';
    } catch (_) {}

    // Activate Chat
    document.getElementById('chat-loading').classList.add('hidden');
    document.getElementById('chat-ui').classList.remove('hidden');
    initSeeds();
    if (session.messages && session.messages.length > 0) {
        for (const msg of session.messages) {
            addMessage(msg.role, msg.text, false);
        }
        document.getElementById('seeds').style.display = 'none';
    }

    // Activate Score
    const forceData = await chrome.storage.local.get(['score_force_rescore']);
    const forceTs = forceData.score_force_rescore || 0;
    const forceRescore = forceTs > 0 && (Date.now() - forceTs) < 15000;
    if (forceRescore) {
        await chrome.storage.local.set({ score_force_rescore: 0 });
    }

    if (session.assessment && session.assessment.is_final && !forceRescore) {
        renderScore(session.assessment);
    } else {
        startScoring(rawJd, url);
    }
};

const init = async () => {
    initTabs();
    
    document.getElementById('send-btn').addEventListener('click', () => {
        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (text) { sendMessage(text); input.value = ''; input.style.height = 'auto'; }
    });
    document.getElementById('msg-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const input = e.target;
            const text = input.value.trim();
            if (text) { sendMessage(text); input.value = ''; input.style.height = 'auto'; }
        }
    });
    document.getElementById('msg-input').addEventListener('input', (e) => {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });

    const storedTab = await chrome.storage.local.get(['sidepanel_active_tab']);
    if (storedTab.sidepanel_active_tab) {
        switchTab(storedTab.sidepanel_active_tab);
    }

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.current_chat_url && changes.current_chat_url.newValue) {
            switchToUrl(changes.current_chat_url.newValue);
        }
        if (changes.chat_sessions && currentUrl && !rawJd) {
            const sessions = changes.chat_sessions.newValue;
            if (sessions && sessions[currentUrl]) {
                switchToUrl(currentUrl);
            }
        }
        if (changes.sidepanel_active_tab && changes.sidepanel_active_tab.newValue !== currentTab) {
            switchTab(changes.sidepanel_active_tab.newValue);
        }
    });

    const stored = await chrome.storage.local.get(['current_chat_url']);
    if (stored.current_chat_url) {
        await switchToUrl(stored.current_chat_url);
    }
};

document.addEventListener('DOMContentLoaded', init);
