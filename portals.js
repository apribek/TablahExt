// Portal definitions for the TablahExt generic crawler
const PORTALS = {
    "profession_hu": {
        name: "Profession.hu",
        domain: "profession.hu",
        // Profession uses /allasok/1,0?keyword=foo&city=bar based on standard URL formats, 
        // but we'll accept a base url and let the UI navigate
        searchUrlTemplate: "https://www.profession.hu/allasok/1,0?keyword={query}&city={location}",
        listLevelSelectors: {
            cardContainer: ".dsx-card, .dsx-job-card, .dsx-job-card-basic, .job-card, .job-list-item, li.job",
            title: ".job-card-title, h2, h3, .title",
            company: ".details-text[aria-label*='cég' i], .details-text[aria-label*='company' i], .job-card-company, .company",
            location: ".details-text[aria-label*='hely' i], .details-text[aria-label*='location' i], .job-card-location, .location",
            excerpt: ".job-card-short-description, .job-card-excerpt, .excerpt, p",
            link: "a.job-card-link, .job-card-title a, .btn-more, a.more"
        },
        nextPageSelector: ".pagination .next, a[aria-label='Next'], a[rel='next']"
    }
    // New portals can be taught and added here dynamically via chrome.storage
};

if (typeof window !== 'undefined') {
    window.PORTALS = PORTALS;
}
