// Renderer Markdown minimale e sicuro: tutto il testo viene prima "escapato",
// quindi né le note né le risposte possono iniettare HTML nell'overlay.
// Supporta: titoli, paragrafi, elenchi (anche annidati e task), citazioni,
// callout di Obsidian, blocchi di codice, tabelle, link, [[wikilink]], #tag.
(function (root) {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(src) {
    const slots = [];
    const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = String(src);
    s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
    s = s.replace(/(!?)\[\[([^\]]+)\]\]/g, (_, bang, inner) => {
      const [target, alias] = inner.split(/\\?\|/);
      const label = (alias || target).trim();
      if (bang && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(target.trim())) {
        // Immagine incorporata: il renderer la carica dal vault.
        return hold(`<span class="embed-img" data-embed="${esc(target.trim())}">🖼 ${esc(label)}</span>`);
      }
      return hold(`<a class="wikilink" data-link="${esc(target.trim())}">${esc(label)}</a>`);
    });
    s = s.replace(/!?\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g, (_, text, url) => {
      if (!/^(https?:|mailto:|obsidian:)/i.test(url)) return hold(esc(text || url));
      return hold(`<a class="ext" data-href="${esc(url)}" title="${esc(url)}">${esc(text || url)}</a>`);
    });
    s = s.replace(/\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g, (url) =>
      hold(`<a class="ext" data-href="${esc(url)}" title="${esc(url)}">${esc(url)}</a>`)
    );
    s = esc(s);
    s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])__(?=\S)(.+?)__(?=$|[\s).,;:!?])/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_(?=[^\s_])([^_]*?[^\s_])_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/==(?=\S)(.+?)==/g, '<mark>$1</mark>');
    s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu, '$1<span class="tag">#$2</span>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
    return s;
  }

  const RE = {
    fence: /^\s*(```+|~~~+)\s*([\w+#.-]*)/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    quote: /^\s*>/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
  };

  function isBlockStart(line, next) {
    return (
      RE.fence.test(line) ||
      RE.heading.test(line) ||
      RE.hr.test(line) ||
      RE.list.test(line) ||
      RE.quote.test(line) ||
      (line.trim().startsWith('|') && next !== undefined && RE.tableSep.test(next))
    );
  }

  function splitRow(row) {
    return row
      .trim()
      .replace(/^\|/, '')
      .replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/) // "\|" dentro una cella (es. alias di un link) non divide
      .map((c) => c.trim());
  }

  function renderList(items) {
    let html = '';
    const stack = [];
    for (const it of items) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) {
        html += `</li></${stack.pop().tag}>`;
      }
      let top = stack[stack.length - 1];
      if (top && it.indent === top.indent && top.tag !== (it.ordered ? 'ol' : 'ul')) {
        html += `</li></${stack.pop().tag}>`; // da elenco puntato a numerato (o viceversa)
        top = stack[stack.length - 1];
      }
      if (!top || it.indent > top.indent) {
        const tag = it.ordered ? 'ol' : 'ul';
        stack.push({ indent: it.indent, tag });
        html += `<${tag}>`;
      } else {
        html += '</li>';
      }
      const task = it.text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      const body = (task ? task[2] : it.text).split('\n').map(inline).join('<br>');
      if (task) {
        const done = task[1] !== ' ';
        html += `<li class="task${done ? ' done' : ''}"><span class="cb" aria-hidden="true"></span>${body}`;
      } else {
        html += `<li>${body}`;
      }
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return html;
  }

  function render(md) {
    const lines = String(md == null ? '' : md)
      .replace(/\r\n?/g, '\n')
      .split('\n');
    const out = [];
    let i = 0;

    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) {
        out.push(`<div class="frontmatter">${esc(lines.slice(1, end).join('\n'))}</div>`);
        i = end + 1;
      }
    }

    while (i < lines.length) {
      const line = lines[i];
      let m;

      if ((m = line.match(RE.fence))) {
        const fence = m[1];
        const lang = m[2];
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      if (!line.trim()) {
        i++;
        continue;
      }
      if ((m = line.match(RE.heading))) {
        const lvl = m[1].length;
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
        i++;
        continue;
      }
      if (RE.hr.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
      if (line.trim().startsWith('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
            head.map((c) => `<th>${inline(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
            '</tbody></table></div>'
        );
        continue;
      }
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        const callout = buf[0].match(/^\[!([\w-]+)\][+-]?\s*(.*)$/);
        if (callout) {
          const kind = callout[1].toLowerCase();
          out.push(
            `<div class="callout callout-${esc(kind)}"><div class="callout-title">${inline(callout[2] || kind)}</div>` +
              `${render(buf.slice(1).join('\n'))}</div>`
          );
        } else {
          out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        }
        continue;
      }
      if (RE.list.test(line)) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const lm = l.match(RE.list);
          if (lm) {
            items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
            i++;
          } else if (l.trim() && /^\s{2,}/.test(l) && items.length && !RE.fence.test(l)) {
            items[items.length - 1].text += `\n${l.trim()}`;
            i++;
          } else {
            break;
          }
        }
        out.push(renderList(items));
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  const api = { render, inline, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Markdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
