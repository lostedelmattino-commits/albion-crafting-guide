/**
 * Main app controller
 */
const App = (() => {
    let searchTimeout = null;
    const history = [];

    function init() {
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const backBtn = document.getElementById('back-btn');

        // Search on input (debounced)
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const query = searchInput.value.trim();
                if (query.length >= 2) {
                    performSearch(query);
                } else {
                    UI.showSection('welcome-screen');
                    UI.showBackNav(false);
                }
            }, 400);
        });

        // Search on Enter
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                const query = searchInput.value.trim();
                if (query.length >= 2) performSearch(query);
            }
        });

        // Search button
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (query.length >= 2) performSearch(query);
        });

        // Back button
        backBtn.addEventListener('click', goBack);

        // Quick search tags
        document.querySelectorAll('.quick-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const query = tag.dataset.search;
                searchInput.value = query;
                performSearch(query);
            });
        });

        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    async function performSearch(query) {
        UI.showLoading('Ricerca...');
        try {
            const results = await WikiAPI.search(query);
            UI.hideLoading();
            UI.renderSearchResults(results, loadItem);
            history.length = 0;
        } catch (err) {
            UI.hideLoading();
            UI.renderSearchResults([], null);
            console.error('Search error:', err);
        }
    }

    async function loadItem(pageTitle) {
        // Save current state for back navigation
        history.push(pageTitle);
        UI.showLoading(`Caricamento ${pageTitle}...`);

        try {
            const page = await WikiAPI.getPage(pageTitle);
            const itemData = CraftingTree.parseItemPage(page.html);
            UI.hideLoading();
            UI.renderItemDetail(page.title, itemData);
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            UI.hideLoading();
            console.error('Load item error:', err);
            document.getElementById('item-detail').innerHTML = `
                <div class="error-state">
                    <p>Errore nel caricamento di "${pageTitle}"</p>
                    <p class="hint">${err.message}</p>
                    <button class="retry-btn" onclick="App.loadItem('${pageTitle.replace(/'/g, "\\'")}')">Riprova</button>
                </div>`;
            UI.showSection('item-detail');
            UI.showBackNav(true);
        }
    }

    function goBack() {
        history.pop(); // Remove current
        if (history.length > 0) {
            const prev = history.pop();
            loadItem(prev);
        } else {
            // Go back to search results
            UI.showSection('search-results');
            UI.showBackNav(false);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { loadItem, goBack };
})();
