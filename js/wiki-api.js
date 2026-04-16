/**
 * MediaWiki API client for Albion Online Wiki
 */
const WikiAPI = (() => {
    const BASE = 'https://wiki.albiononline.com';
    const API = `${BASE}/api.php`;
    const cache = new Map();

    // Categories that disqualify a page from being a craftable/obtainable item
    const EXCLUDED_CATEGORIES = new Set([
        'Mobs', 'Resource Mob', 'Ability', 'Disambiguations', 'Crafting',
        'Furniture', 'Decoration', 'Laborers', 'Trophy',
        'Sword Ability', 'Axe Ability', 'Bow Ability', 'Crossbow Ability',
        'Dagger Ability', 'Fire Staff Ability', 'Frost Staff Ability',
        'Holy Staff Ability', 'Nature Staff Ability', 'Arcane Staff Ability',
        'Hammer Ability', 'Mace Ability', 'Quarterstaff Ability', 'Spear Ability',
        'Torch Ability', 'Warbow Ability', 'Updated IP'
    ]);

    // Title patterns to exclude regardless of category
    const EXCLUDED_TITLE_PATTERNS = [
        /Crafting Specialist$/i,
        / Fighter$/i,
        / Crafter$/i,
        /variant table header$/i,
        /^Category:/i,
    ];

    async function fetchJSON(url) {
        if (cache.has(url)) return cache.get(url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        cache.set(url, data);
        return data;
    }

    /**
     * Search items - returns only items/equipment/mounts (not mobs or abilities)
     * Returns array of {title, url}
     */
    async function search(query) {
        if (!query || query.trim().length < 2) return [];

        // Use opensearch for fast autocomplete results
        const url = `${API}?action=opensearch&search=${encodeURIComponent(query)}&limit=25&namespace=0&format=json&origin=*`;
        const data = await fetchJSON(url);
        const titles = data[1] || [];
        const urls = data[3] || [];

        // Pre-filter by title pattern (fast, no extra API call needed)
        const candidates = titles
            .map((title, i) => ({ title, url: urls[i] || '' }))
            .filter(r => !EXCLUDED_TITLE_PATTERNS.some(p => p.test(r.title)));

        if (candidates.length === 0) return [];

        // Batch-query categories to filter out mobs and abilities
        const titlesParam = candidates.map(r => encodeURIComponent(r.title)).join('|');
        const catUrl = `${API}?action=query&titles=${titlesParam}&prop=categories&cllimit=15&format=json&origin=*`;
        try {
            const catData = await fetchJSON(catUrl);
            const pageCategories = {};
            Object.values(catData.query.pages).forEach(p => {
                const cats = (p.categories || []).map(c => c.title.replace('Category:', ''));
                pageCategories[p.title] = cats;
            });

            return candidates.filter(r => {
                const cats = pageCategories[r.title] || [];
                // Reject if no categories at all (wiki infrastructure pages)
                if (cats.length === 0) return false;
                // Reject if any excluded category present
                if (cats.some(c => EXCLUDED_CATEGORIES.has(c))) return false;
                return true;
            });
        } catch {
            // If category check fails, return pre-filtered candidates
            return candidates;
        }
    }

    /**
     * Get parsed HTML content of a wiki page
     * Returns { title, html, images }
     */
    async function getPage(pageTitle) {
        const url = `${API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text|images&format=json&origin=*`;
        const data = await fetchJSON(url);
        if (data.error) throw new Error(data.error.info);
        return {
            title: data.parse.title,
            html: data.parse.text['*'],
            images: data.parse.images || []
        };
    }

    function clearCache() {
        cache.clear();
    }

    function getWikiUrl(pageTitle) {
        return `${BASE}/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
    }

    return { search, getPage, clearCache, getWikiUrl, BASE };
})();
