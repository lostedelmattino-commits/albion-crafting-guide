/**
 * Crafting tree parser - extracts recipes from wiki HTML
 */
const CraftingTree = (() => {

    /**
     * Parse the HTML of an item page and extract all info
     */
    function parseItemPage(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const result = {
            description: '',
            tier: '',
            weight: '',
            itemValue: '',
            recipes: [],
            image: null,
            spells: { q: [], w: [], e: [], passive: [] },
            relatedItems: []
        };

        // Extract basic info from the infobox-like structure
        const allText = doc.body.textContent;

        // Find tier
        const tierMatch = allText.match(/Tier\s*(\d+)/i);
        if (tierMatch) result.tier = tierMatch[1];

        // Find description paragraph (first meaningful paragraph)
        const paragraphs = doc.querySelectorAll('p');
        for (const p of paragraphs) {
            const text = p.textContent.trim();
            if (text.length > 20 && !text.startsWith('Retrieved from')) {
                result.description = text;
                break;
            }
        }

        // Extract item image - prefer render.albiononline.com images or first large image
        const imgs = doc.querySelectorAll('img');
        for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            if (src.includes('render.albiononline.com') && src.includes(encodeURIComponent(doc.querySelector('h1,h2')?.textContent?.trim()?.split("'s ")?.pop() || '___'))) {
                result.image = src;
                break;
            }
        }
        // Fallback: first render image or first large wiki image
        if (!result.image) {
            for (const img of imgs) {
                const src = img.getAttribute('src') || '';
                const width = parseInt(img.getAttribute('width') || '0');
                if (src.includes('render.albiononline.com') && width >= 50) {
                    result.image = src;
                    break;
                }
                if (!result.image && src.includes('.png') && !src.includes('icon') && !src.includes('logo') && !src.includes('mediawiki') && width >= 50) {
                    result.image = src.startsWith('http') ? src : `https://wiki.albiononline.com${src}`;
                    break;
                }
            }
        }

        // Extract crafting recipes from tables
        const tables = doc.querySelectorAll('table');
        for (const table of tables) {
            const tableText = table.textContent;
            const firstRow = table.querySelector('tr');
            const firstRowText = firstRow ? firstRow.textContent.trim() : '';

            // SKIP "Used In" tables (Recipe name + Ingredient columns)
            if (firstRowText.includes('Recipe name') && firstRowText.includes('Ingredient')) {
                continue;
            }
            // SKIP stats/patch tables
            if (firstRowText.includes('Item Quality') || firstRowText.includes('Patch Link') || firstRowText.includes('Item Power')) {
                continue;
            }

            const caption = table.querySelector('caption, th, td');
            const headerText = caption ? caption.textContent : '';

            // Detect crafting recipe tables (weapon/armor style: "Recipe" in header)
            if (headerText.toLowerCase().includes('recipe') ||
                (tableText.includes('Item Name') && tableText.includes('Quantity'))) {
                const recipe = parseRecipeTable(table, headerText);
                if (recipe && recipe.materials.length > 0) {
                    result.recipes.push(recipe);
                }
            }
            // Detect resource refining tables (material style: "Resource Name" + "Quantity")
            else if (tableText.includes('Resource Name') && tableText.includes('Quantity')) {
                const recipe = parseResourceTable(table);
                if (recipe && recipe.materials.length > 0) {
                    result.recipes.push(recipe);
                }
            }
        }

        // If no recipes found, try finding by "Crafting Requirements" section header
        if (result.recipes.length === 0) {
            const headers = doc.querySelectorAll('h2, h3');
            for (const header of headers) {
                if (header.textContent.includes('Crafting') || header.textContent.includes('Refining')) {
                    let el = header.nextElementSibling;
                    while (el && !['H2', 'H3'].includes(el.tagName)) {
                        if (el.tagName === 'TABLE') {
                            const recipe = parseRecipeTable(el, '');
                            if (recipe && recipe.materials.length > 0) {
                                result.recipes.push(recipe);
                            }
                        }
                        el = el.nextElementSibling;
                    }
                }
            }
        }

        // Extract related items (weapon families, tiers)
        const familyHeaders = doc.querySelectorAll('h2, h3');
        for (const header of familyHeaders) {
            const text = header.textContent;
            if (text.includes('Additional') || text.includes('Families') || text.includes('Tiers')) {
                let el = header.nextElementSibling;
                while (el && !['H2', 'H3'].includes(el.tagName)) {
                    if (el.tagName === 'TABLE') {
                        const links = el.querySelectorAll('a[href*="/wiki/"]');
                        for (const link of links) {
                            const href = link.getAttribute('href');
                            const name = link.textContent.trim();
                            if (name && href && !href.includes('Category:') && !href.includes('Special:')) {
                                const pageTitle = decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' '));
                                if (!result.relatedItems.find(r => r.title === pageTitle)) {
                                    result.relatedItems.push({ title: pageTitle, name });
                                }
                            }
                        }
                    }
                    el = el.nextElementSibling;
                }
            }
        }

        return result;
    }

    /**
     * Parse a single recipe table
     */
    function parseRecipeTable(table, headerText) {
        const recipe = {
            name: headerText.trim(),
            materials: [],
            produces: ''
        };

        const rows = table.querySelectorAll('tr');

        for (const row of rows) {
            const cells = row.querySelectorAll('td, th');
            if (cells.length === 0) continue;

            const rowText = row.textContent.trim();

            // Skip header/title rows
            if (rowText.includes('Item Name') || rowText.includes('Quantity') || rowText.includes('Recipe')) {
                continue;
            }

            // Check for "Produces" row
            if (rowText.toLowerCase().includes('produces')) {
                const producesLink = row.querySelector('a[href*="/wiki/"]');
                if (producesLink) {
                    recipe.produces = producesLink.textContent.trim();
                }
                continue;
            }

            // Look for material rows: they have a link to a wiki page and a quantity
            const links = row.querySelectorAll('a[href*="/wiki/"]');
            if (links.length === 0) continue;

            // Find the best link (prefer one with text content, or use title attribute)
            let bestLink = null;
            let materialName = '';
            for (const l of links) {
                const href = l.getAttribute('href') || '';
                if (href.includes('Category:') || href.includes('Special:') || href.includes('File:')) continue;
                if (l.classList.contains('mw-selflink')) continue;
                const text = l.textContent.trim();
                const title = l.getAttribute('title') || '';
                if (text && text.length > 1) {
                    bestLink = l;
                    materialName = text;
                    break;
                }
                if (!bestLink && title) {
                    bestLink = l;
                    materialName = title;
                }
            }
            if (!bestLink || !materialName) continue;
            const href = bestLink.getAttribute('href') || '';

            // Try to find quantity
            let quantity = '';
            for (const cell of cells) {
                const cellText = cell.textContent.trim();
                if (/^\d+$/.test(cellText)) {
                    quantity = cellText;
                    break;
                }
            }

            // Avoid duplicate entries in the same recipe
            if (!recipe.materials.find(m => m.name === materialName)) {
                const pageTitle = decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' '));
                recipe.materials.push({
                    name: materialName,
                    quantity: quantity || '?',
                    pageTitle: pageTitle,
                    wikiUrl: `https://wiki.albiononline.com${href}`
                });
            }
        }

        // Extract recipe name from first cell if not set
        if (!recipe.name) {
            const firstTh = table.querySelector('th');
            if (firstTh) recipe.name = firstTh.textContent.trim();
        }

        return recipe;
    }

    /**
     * Parse resource/refining table (materials like Steel Bar, Worked Leather)
     * Format: Nutrition Used | Cost | Resource Name | Quantity
     * Materials are grouped - rows with fewer columns are part of the same recipe
     */
    function parseResourceTable(table) {
        const recipe = {
            name: 'Ricetta di Raffinazione',
            materials: [],
            produces: ''
        };

        const rows = table.querySelectorAll('tr');
        let currentRecipeMaterials = [];

        for (const row of rows) {
            const rowText = row.textContent.trim();

            // Skip header row
            if (rowText.includes('Resource Name') || rowText.includes('Nutrition Used')) {
                continue;
            }

            const links = row.querySelectorAll('a[href*="/wiki/"]');
            if (links.length === 0) continue;

            // Find material link
            for (const link of links) {
                const href = link.getAttribute('href') || '';
                if (href.includes('Category:') || href.includes('Special:') || href.includes('File:')) continue;
                const title = link.getAttribute('title') || '';
                const text = link.textContent.trim();
                const materialName = (text && text.length > 1) ? text : title;
                if (!materialName || materialName === 'Silver') continue;

                // Find quantity in the row
                const cells = row.querySelectorAll('td, th');
                let quantity = '';
                for (const cell of cells) {
                    const cellText = cell.textContent.trim();
                    if (/^\d+$/.test(cellText)) {
                        quantity = cellText;
                    }
                }

                const pageTitle = decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' '));
                if (!recipe.materials.find(m => m.name === materialName)) {
                    recipe.materials.push({
                        name: materialName,
                        quantity: quantity || '?',
                        pageTitle: pageTitle,
                        wikiUrl: `https://wiki.albiononline.com${href}`
                    });
                }
                break; // One material per row
            }
        }

        return recipe;
    }

    /**
     * Load crafting tree for a material (recursive, lazy)
     * Returns the parsed item data with nested recipes
     */
    async function loadMaterialTree(pageTitle) {
        try {
            const page = await WikiAPI.getPage(pageTitle);
            return parseItemPage(page.html);
        } catch (e) {
            console.warn(`Could not load crafting for: ${pageTitle}`, e);
            return null;
        }
    }

    return { parseItemPage, loadMaterialTree };
})();
