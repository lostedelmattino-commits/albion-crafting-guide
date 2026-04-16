/**
 * Crafting tree parser - extracts recipes and zone locations from wiki HTML
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
            recipes: [],
            image: null,
            zones: [],         // Where to find this (for base resources)
            tierItems: [],     // Specific tier variants for family pages (e.g. "Bloodmoon Staff")
            relatedItems: []
        };

        const allText = doc.body.textContent;

        // Find tier
        const tierMatch = allText.match(/Tier\s*(\d+)/i);
        if (tierMatch) result.tier = tierMatch[1];

        // Find first meaningful description paragraph
        for (const p of doc.querySelectorAll('p')) {
            const text = p.textContent.trim();
            if (text.length > 20 && !text.startsWith('Retrieved from')) {
                result.description = text;
                break;
            }
        }

        // Extract item image
        result.image = extractImage(doc);

        // Extract zone locations (for raw resources like Iron Ore, Fiber, etc.)
        result.zones = extractZones(doc);

        // Extract crafting recipes from tables
        for (const table of doc.querySelectorAll('table')) {
            const firstRowText = (table.querySelector('tr') || {}).textContent?.trim() || '';
            const tableText = table.textContent;

            // Skip non-recipe tables
            if (firstRowText.includes('Recipe name') && firstRowText.includes('Ingredient')) continue;
            if (firstRowText.includes('Item Quality') || firstRowText.includes('Patch Link') || firstRowText.includes('Item Power')) continue;

            const headerText = (table.querySelector('caption, th, td') || {}).textContent || '';

            if (headerText.toLowerCase().includes('recipe') || (tableText.includes('Item Name') && tableText.includes('Quantity'))) {
                const recipe = parseRecipeTable(table, headerText);
                if (recipe?.materials.length > 0) result.recipes.push(recipe);
            } else if (tableText.includes('Resource Name') && tableText.includes('Quantity')) {
                const recipe = parseResourceTable(table);
                if (recipe?.materials.length > 0) result.recipes.push(recipe);
            }
        }

        // Fallback: scan sections for crafting headers
        if (result.recipes.length === 0) {
            for (const header of doc.querySelectorAll('h2, h3')) {
                if (!header.textContent.includes('Crafting') && !header.textContent.includes('Refining')) continue;
                let el = header.nextElementSibling;
                while (el && !['H2', 'H3'].includes(el.tagName)) {
                    if (el.tagName === 'TABLE') {
                        const recipe = parseRecipeTable(el, '');
                        if (recipe?.materials.length > 0) result.recipes.push(recipe);
                    }
                    el = el.nextElementSibling;
                }
            }
        }

        // Extract tier items from family pages (e.g. "Bloodmoon Staff" → Adept's, Expert's...)
        // Table 0 with "Item | Tier" header pattern is the tier listing table
        if (result.recipes.length === 0) {
            const firstTable = doc.querySelector('table');
            if (firstTable) {
                const firstRowText = firstTable.querySelector('tr')?.textContent?.trim() || '';
                if (firstRowText.includes('Item') && firstRowText.includes('Tier')) {
                    const TIER_PREFIXES = ["Beginner's", "Novice's", "Journeyman's", "Adept's",
                        "Expert's", "Master's", "Grandmaster's", "Elder's"];
                    for (const link of firstTable.querySelectorAll('a[href*="/wiki/"]')) {
                        const href = link.getAttribute('href') || '';
                        const title = link.getAttribute('title') || link.textContent.trim();
                        if (!title || href.includes('Category:') || href.includes('Special:')) continue;
                        if (TIER_PREFIXES.some(p => title.startsWith(p))) {
                            const pageTitle = decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' '));
                            if (!result.tierItems.find(t => t.title === pageTitle)) {
                                result.tierItems.push({ title: pageTitle, name: title });
                            }
                        }
                    }
                }
            }
        }

        // Extract related items (other tiers / weapon families)
        for (const header of doc.querySelectorAll('h2, h3')) {
            const text = header.textContent;
            if (!text.includes('Additional') && !text.includes('Families') && !text.includes('Tiers')) continue;
            let el = header.nextElementSibling;
            while (el && !['H2', 'H3'].includes(el.tagName)) {
                if (el.tagName === 'TABLE') {
                    for (const link of el.querySelectorAll('a[href*="/wiki/"]')) {
                        const href = link.getAttribute('href');
                        const name = link.textContent.trim();
                        if (!name || !href || href.includes('Category:') || href.includes('Special:')) continue;
                        const pageTitle = decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' '));
                        if (!result.relatedItems.find(r => r.title === pageTitle)) {
                            result.relatedItems.push({ title: pageTitle, name });
                        }
                    }
                }
                el = el.nextElementSibling;
            }
        }

        return result;
    }

    /**
     * Extract the main item image from the page
     */
    function extractImage(doc) {
        // Try to match render.albiononline.com image for this specific item
        const h1Text = doc.querySelector('h1')?.textContent?.trim() || '';
        for (const img of doc.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (src.includes('render.albiononline.com')) {
                // Prefer large images (width attr >= 64 or no width means it's in the infobox)
                const width = parseInt(img.getAttribute('width') || '0');
                if (width >= 64 || width === 0) {
                    return src;
                }
            }
        }
        // Fallback to first render image of any size
        for (const img of doc.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (src.includes('render.albiononline.com')) return src;
        }
        return null;
    }

    /**
     * Extract zone/biome locations where a resource can be found.
     * The wiki lists zones in a "Zone Locations" paragraph in the page body.
     */
    function extractZones(doc) {
        const bodyText = doc.body.textContent;
        const zoneIdx = bodyText.indexOf('Zone Locations');
        if (zoneIdx === -1) return [];

        // Grab text after "Zone Locations" until a double newline or next section header
        const after = bodyText.substring(zoneIdx + 'Zone Locations'.length, zoneIdx + 3000).trim();

        // Zone names are concatenated without separators - split on capital letters
        // They look like "AdrensHillAstolatBattlebrae..." - split on uppercase following lowercase
        const zonePart = after.split(/\n{2,}|##/)[0].trim();

        if (!zonePart) return [];

        // Split camelCase-like concatenated zone names into individual zones
        // Pattern: split before uppercase letter that follows a lowercase letter/number
        const zones = zonePart
            .replace(/([a-z])([A-Z])/g, '$1|$2')
            .split('|')
            .map(z => z.trim())
            .filter(z => z.length > 3 && /^[A-Z]/.test(z));

        // Deduplicate and limit
        return [...new Set(zones)].slice(0, 30);
    }

    /**
     * Parse a weapon/armor recipe table (has Item Name + Quantity columns)
     */
    function parseRecipeTable(table, headerText) {
        const recipe = { name: headerText.trim(), materials: [], produces: '' };

        for (const row of table.querySelectorAll('tr')) {
            if (!row.querySelectorAll('td, th').length) continue;
            const rowText = row.textContent.trim();

            if (rowText.includes('Item Name') || rowText.includes('Quantity') || rowText.includes('Recipe')) continue;

            if (rowText.toLowerCase().includes('produces')) {
                const link = row.querySelector('a[href*="/wiki/"]');
                if (link) recipe.produces = link.textContent.trim();
                continue;
            }

            const { name, href } = bestMaterialLink(row);
            if (!name) continue;

            const quantity = findQuantity(row);
            if (!recipe.materials.find(m => m.name === name)) {
                recipe.materials.push({
                    name,
                    quantity,
                    pageTitle: decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' ')),
                    wikiUrl: `https://wiki.albiononline.com${href}`
                });
            }
        }

        if (!recipe.name) {
            recipe.name = table.querySelector('th')?.textContent.trim() || '';
        }
        return recipe;
    }

    /**
     * Parse a refining/resource table (Nutrition Used | Cost | Resource Name | Quantity)
     */
    function parseResourceTable(table) {
        const recipe = { name: 'Ricetta di Raffinazione', materials: [], produces: '' };

        for (const row of table.querySelectorAll('tr')) {
            const rowText = row.textContent.trim();
            if (rowText.includes('Resource Name') || rowText.includes('Nutrition Used')) continue;

            const { name, href } = bestMaterialLink(row, ['Silver']);
            if (!name) continue;

            const quantity = findQuantity(row);
            if (!recipe.materials.find(m => m.name === name)) {
                recipe.materials.push({
                    name,
                    quantity,
                    pageTitle: decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' ')),
                    wikiUrl: `https://wiki.albiononline.com${href}`
                });
            }
        }
        return recipe;
    }

    /** Find the best material link in a row (prefers text links over image-only links) */
    function bestMaterialLink(row, excludeNames = []) {
        for (const link of row.querySelectorAll('a[href*="/wiki/"]')) {
            const href = link.getAttribute('href') || '';
            if (href.includes('Category:') || href.includes('Special:') || href.includes('File:')) continue;
            if (link.classList.contains('mw-selflink')) continue;
            const text = link.textContent.trim();
            const title = link.getAttribute('title') || '';
            const name = (text.length > 1) ? text : title;
            if (!name || excludeNames.includes(name)) continue;
            return { name, href };
        }
        return { name: null, href: null };
    }

    /** Find the first numeric cell value in a row (the quantity) */
    function findQuantity(row) {
        for (const cell of row.querySelectorAll('td, th')) {
            if (/^\d+$/.test(cell.textContent.trim())) return cell.textContent.trim();
        }
        return '?';
    }

    /**
     * Load the crafting/zone data for a material page (used by recursive tree)
     */
    async function loadMaterialTree(pageTitle) {
        try {
            const page = await WikiAPI.getPage(pageTitle);
            return parseItemPage(page.html);
        } catch (e) {
            console.warn(`Could not load: ${pageTitle}`, e);
            return null;
        }
    }

    return { parseItemPage, loadMaterialTree };
})();
