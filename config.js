// Tablah Extension Configuration
// Update these when deploying to production
const CONFIG = {
    // API_BASE: "https://api.mytablah.hu/api", // Production
    API_BASE: "http://localhost:8000/api",    // Local

    // APP_URL: "https://tablah.hu",           // Production
    APP_URL: "http://localhost:3000",         // Local

    COOKIE_DOMAIN: "localhost",               // Use domain name in production (no protocol)
    SCORE_API_URL: "/assessments/score",
    JOBS_API_URL: "/jobs",
    DRAFT_API_URL: "/experiences/draft"
};

// Make it globally accessible for other scripts
if (typeof self !== 'undefined') {
    self.CONFIG = CONFIG;
} else if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
