// Tablah Extension Configuration
// To develop locally: change ENV to "local" — never commit that change
const ENV = "production";

const _ENVS = {
    local: {
        API_BASE: "http://localhost:8000/api",
        APP_URL: "http://localhost:3000",
        COOKIE_DOMAIN: "localhost",
    },
    production: {
        API_BASE: "https://cv-aution-backend.onrender.com",
        APP_URL: "https://tablah.ai",
        COOKIE_DOMAIN: "tablah.ai",
    },
};

const CONFIG = {
    ..._ENVS[ENV],
    SCORE_API_URL: "/assessments/score",
    JOBS_API_URL: "/jobs",
    INGEST_API_URL: "/jobs/ingest",
    DRAFT_API_URL: "/experiences/draft",
    CHAT_API_URL: "/chat/message",
};

if (typeof self !== "undefined") {
    self.CONFIG = CONFIG;
} else if (typeof window !== "undefined") {
    window.CONFIG = CONFIG;
}
