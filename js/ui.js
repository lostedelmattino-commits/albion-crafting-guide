/**
 * UI rendering module
 */
const UI = (() => {
    const $ = id => document.getElementById(id);

    function showLoading(text = 'Caricamento...') {
        $('loading-text').textContent = text;
        $('loading-overlay').classList.remove('hidden');
    }

    function hideLoading() {
        $('loading-overlay').classList.add('hidden');
    }

    function showSection(id) {
        ['search-results', 'item-detail', 'welcome-screen'].forEach(s => {
            $(s).classList.add('hidden');
        });
        $(id).classList.remove('hidden');
    }

    function showBackNav(show) {
        $('back-nav').classList.toggle('hidden', !show);
    }

    /**
     * Render search results
     */
    function renderSearchResults(results, onItemClick) {
        const container = $('search-results');
        showSection('search-results');
        showBackNav(false);

        if (results.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Nessun risultato trovato.</p>
                    <p class="hint">Prova con un termine diverso (in inglese).</p>
                </div>`;
            return;
        }

        container.innerHTML = `
            <div class="results-header">
                <span>${results.length} risultati</span>
            </div>
            <div class="results-list">
                ${results.map(r => `
                    <button class="result-card" data-title="${escapeAttr(r.title)}">
                        <div class="result-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                            </svg>
                        </div>
                        <div class="result-info">
                            <span class="result-name">${escapeHtml(r.title)}</span>
                            <span class="result-url">${escapeHtml(r.url)}</span>
                        </div>
                        <svg class="result-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="m9 18 6-6-6-6"/>
                        </svg>
                    </button>
                `).join('')}
            </div>`;

        container.querySelectorAll('.result-card').forEach(card => {
            card.addEventListener('click', () => onItemClick(card.dataset.title));
        });
    }

    /**
     * Render item detail page
     */
    function renderItemDetail(title, itemData) {
        const container = $('item-detail');
        showSection('item-detail');
        showBackNav(true);

        const hasRecipes = itemData.recipes.length > 0;

        container.innerHTML = `
            <div class="item-header-card">
                ${itemData.image ? `<img class="item-image" src="${escapeAttr(itemData.image)}" alt="${escapeAttr(title)}" onerror="this.style.display='none'">` : ''}
                <div class="item-header-info">
                    <h2 class="item-title">${escapeHtml(title)}</h2>
                    ${itemData.tier ? `<span class="item-tier">Tier ${escapeHtml(itemData.tier)}</span>` : ''}
                    ${itemData.description ? `<p class="item-desc">${escapeHtml(itemData.description)}</p>` : ''}
                    <a class="wiki-link" href="${WikiAPI.getWikiUrl(title)}" target="_blank" rel="noopener">
                        Apri su Wiki
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                    </a>
                </div>
            </div>

            ${hasRecipes ? `
                <div class="section-title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Ricette di Crafting
                </div>
                <div id="recipes-container">
                    ${itemData.recipes.map((recipe, i) => renderRecipe(recipe, i)).join('')}
                </div>
            ` : `
                <div class="no-recipes">
                    <p>Nessuna ricetta di crafting trovata per questo oggetto.</p>
                    <p class="hint">Potrebbe essere un materiale base o un drop.</p>
                </div>
            `}

            ${itemData.relatedItems.length > 0 ? `
                <div class="section-title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    Oggetti Correlati
                </div>
                <div class="related-items">
                    ${itemData.relatedItems.slice(0, 12).map(item => `
                        <button class="related-tag" data-title="${escapeAttr(item.title)}">
                            ${escapeHtml(item.name)}
                        </button>
                    `).join('')}
                </div>
            ` : ''}
        `;

        // Bind expand buttons for sub-materials
        container.querySelectorAll('.material-expand-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pageTitle = btn.dataset.page;
                const targetId = btn.dataset.target;
                expandMaterial(pageTitle, targetId, btn);
            });
        });

        // Bind related item clicks
        container.querySelectorAll('.related-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                App.loadItem(tag.dataset.title);
            });
        });
    }

    /**
     * Render a single recipe accordion
     */
    function renderRecipe(recipe, index) {
        const isFirst = index === 0;
        return `
            <div class="recipe-card ${isFirst ? 'open' : ''}">
                <button class="recipe-header" onclick="this.parentElement.classList.toggle('open')">
                    <span class="recipe-name">${escapeHtml(recipe.name || `Ricetta ${index + 1}`)}</span>
                    <svg class="recipe-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="m6 9 6 6 6-6"/>
                    </svg>
                </button>
                <div class="recipe-body">
                    <div class="materials-list">
                        ${recipe.materials.map(mat => {
                            const subId = `sub-${index}-${mat.pageTitle.replace(/[^a-zA-Z0-9]/g, '_')}`;
                            return `
                                <div class="material-row">
                                    <div class="material-main">
                                        <span class="material-qty">${escapeHtml(mat.quantity)}x</span>
                                        <span class="material-name">${escapeHtml(mat.name)}</span>
                                        <button class="material-expand-btn" data-page="${escapeAttr(mat.pageTitle)}" data-target="${subId}" title="Vedi sotto-ricetta">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="m6 9 6 6 6-6"/>
                                            </svg>
                                        </button>
                                    </div>
                                    <div class="sub-materials hidden" id="${subId}">
                                        <div class="sub-loading">Caricamento sotto-ricetta...</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    ${recipe.produces ? `<div class="recipe-produces">Produce: <strong>${escapeHtml(recipe.produces)}</strong></div>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Expand a material to show its sub-recipe
     */
    async function expandMaterial(pageTitle, targetId, btn) {
        const target = document.getElementById(targetId);
        if (!target) return;

        // Toggle visibility
        if (!target.classList.contains('hidden') && !target.querySelector('.sub-loading')) {
            target.classList.add('hidden');
            btn.classList.remove('expanded');
            return;
        }

        target.classList.remove('hidden');
        btn.classList.add('expanded');
        target.innerHTML = '<div class="sub-loading"><div class="spinner small"></div> Caricamento...</div>';

        const itemData = await CraftingTree.loadMaterialTree(pageTitle);

        if (!itemData || itemData.recipes.length === 0) {
            target.innerHTML = `
                <div class="sub-base-material">
                    <span class="base-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>
                        </svg>
                    </span>
                    <strong>${escapeHtml(pageTitle)}</strong> - Materiale base / drop / raccolto
                </div>`;
            return;
        }

        // Show first recipe only for sub-materials
        const recipe = itemData.recipes[0];
        target.innerHTML = `
            <div class="sub-recipe-title">${escapeHtml(recipe.name || 'Ricetta')}</div>
            ${recipe.materials.map(mat => {
                const subSubId = `${targetId}_${mat.pageTitle.replace(/[^a-zA-Z0-9]/g, '_')}`;
                return `
                    <div class="material-row sub-level">
                        <div class="material-main">
                            <span class="material-qty">${escapeHtml(mat.quantity)}x</span>
                            <span class="material-name">${escapeHtml(mat.name)}</span>
                            <button class="material-expand-btn" data-page="${escapeAttr(mat.pageTitle)}" data-target="${subSubId}" title="Vedi sotto-ricetta">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="m6 9 6 6 6-6"/>
                                </svg>
                            </button>
                        </div>
                        <div class="sub-materials hidden" id="${subSubId}">
                            <div class="sub-loading">Caricamento...</div>
                        </div>
                    </div>
                `;
            }).join('')}
        `;

        // Rebind expand buttons for deeper levels
        target.querySelectorAll('.material-expand-btn').forEach(subBtn => {
            subBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                expandMaterial(subBtn.dataset.page, subBtn.dataset.target, subBtn);
            });
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return { showLoading, hideLoading, showSection, showBackNav, renderSearchResults, renderItemDetail };
})();
