let conversationId = null;
let rawJd = null;
let isWaiting = false;
let currentUrl = null;

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
    setTimeout(() => { bar.style.display = 'none'; }, 6000);
};

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
        showError(e.message);
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
};

const showLoadingState = (msg = 'Loading job context…') => {
    document.getElementById('loading-state').style.display = 'flex';
    document.getElementById('loading-state').innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
    document.getElementById('chat-ui').style.display = 'none';
};

const activateChat = (session) => {
    rawJd = session.rawJd;

    try {
        const display = session.title
            ? session.title.slice(0, 60)
            : new URL(currentUrl).hostname.replace('www.', '');
        document.getElementById('job-source').textContent = display;
        document.getElementById('job-banner').style.display = 'block';
    } catch (_) {}

    document.getElementById('loading-state').style.display = 'none';
    const chatUi = document.getElementById('chat-ui');
    chatUi.style.display = 'flex';
    chatUi.style.flexDirection = 'column';

    initSeeds();
    document.getElementById('msg-input').focus();
};

const purgeSessions = async () => {
    const data = await chrome.storage.local.get(['chat_sessions']);
    const sessions = data.chat_sessions || {};
    const cutoff = Date.now() - TTL_MS;
    let pruned = false;
    for (const url of Object.keys(sessions)) {
        if ((sessions[url].lastAccessed || 0) < cutoff) {
            delete sessions[url];
            pruned = true;
        }
    }
    if (pruned) await chrome.storage.local.set({ chat_sessions: sessions });
};

const switchToUrl = async (url) => {
    currentUrl = url;
    conversationId = null;
    rawJd = null;
    isWaiting = false;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('seeds').innerHTML = '';
    document.getElementById('send-btn').disabled = false;
    document.getElementById('msg-input').disabled = false;
    showLoadingState('Detecting job…');

    const data = await chrome.storage.local.get(['chat_sessions']);
    const sessions = data.chat_sessions || {};
    const session = sessions[url];

    if (!session) return; // Scrape still in progress — wait for chat_sessions update

    // Extend TTL
    session.lastAccessed = Date.now();
    sessions[url] = session;
    await chrome.storage.local.set({ chat_sessions: sessions });

    if (!session.rawJd) {
        document.getElementById('loading-state').innerHTML =
            '<p style="color:#94a3b8;text-align:center;padding:24px;">No job detected on this page.</p>';
        return;
    }

    conversationId = session.conversationId || null;
    activateChat(session);

    if (session.messages && session.messages.length > 0) {
        for (const msg of session.messages) {
            addMessage(msg.role, msg.text, false);
        }
        document.getElementById('seeds').style.display = 'none';
    }
};

const init = async () => {
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

    await purgeSessions();

    let timeoutId = null;

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.current_chat_url && changes.current_chat_url.newValue) {
            if (timeoutId) clearTimeout(timeoutId);
            switchToUrl(changes.current_chat_url.newValue);
        }
        // Scrape completed for a URL the panel is waiting on
        if (changes.chat_sessions && currentUrl && !rawJd) {
            const sessions = changes.chat_sessions.newValue;
            if (sessions && sessions[currentUrl]) {
                if (timeoutId) clearTimeout(timeoutId);
                switchToUrl(currentUrl);
            }
        }
    });

    const stored = await chrome.storage.local.get(['current_chat_url']);
    if (stored.current_chat_url) {
        await switchToUrl(stored.current_chat_url);
    }

    if (!rawJd) {
        timeoutId = setTimeout(() => {
            if (!rawJd) {
                document.getElementById('loading-state').innerHTML =
                    '<p style="color:#94a3b8;text-align:center;padding:24px;">No job detected.<br>Right-click a job page and choose<br>"Chat about this job with Tablah".</p>';
            }
        }, 5000);
    }
};

document.addEventListener('DOMContentLoaded', init);
