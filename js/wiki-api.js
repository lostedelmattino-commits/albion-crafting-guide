/**
 * MediaWiki API client for Albion Online Wiki
 */
const WikiAPI = (() => {
    const BASE = 'https://wiki.albiononline.com';
    const API = `${BASE}/api.php`;
    const cache = new Map();

    async function fetchJSON(url) {
        if (cache.has(url)) return cache.get(url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        cache.set(url, data);
        return data;
    }

    /**
     * Search items using opensearch API
     * Returns array of {title, url}
     */
    async function search(query) {
        if (!query || query.trim().length < 2) return [];
        const url = `${API}?action=opensearch&search=${encodeURIComponent(query)}&limit=20&namespace=0&format=json&origin=*`;
        const data = await fetchJSON(url);
        // opensearch returns [query, [titles], [descriptions], [urls]]
        const titles = data[1] || [];
        const urls = data[3] || [];
        return titles.map((title, i) => ({ title, url: urls[i] || '' }));
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

    /**
     * Get image URL from wiki
     */
    async function getImageUrl(filename) {
        const url = `${API}?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
        const data = await fetchJSON(url);
        const pages = data.query.pages;
        const page = Object.values(pages)[0];
        if (page.imageinfo && page.imageinfo[0]) {
            return page.imageinfo[0].url;
        }
        return null;
    }

    function clearCache() {
        cache.clear();
    }

    function getWikiUrl(pageTitle) {
        return `${BASE}/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
    }

    return { search, getPage, getImageUrl, clearCache, getWikiUrl, BASE };
})();
