// Settings > Video info block: which GPU renders the game, the render resolution / MSAA of the active preset, and
// for integrated GPUs on Windows how to move the browser onto the dedicated GPU. Mounted once by Menu.init; it
// refreshes itself on the game's 'quality' and 'resize' events (Render scale changes emit 'resize').

import { esc } from './dom.js';

const KIND_LABEL = { integrated: 'integrated', discrete: 'dedicated', apple: 'Apple silicon', software: 'software renderer', unknown: '' };
const QUALITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/**
 * Add the info block under the Video settings group and keep it current.
 * @param {HTMLElement} root the menu root (contains the settings screen)
 * @param {object} game needs getGraphicsInfo() and events
 * @returns {(() => void)|null} refresh function (null when the Video group or the game API is missing)
 */
export function mountGraphicsInfo(root, game) {
  const anchor = root.querySelector('[data-set="quality"]');
  const group = anchor && anchor.closest('.set-group');
  if (!group || typeof game.getGraphicsInfo !== 'function') return null;
  const el = document.createElement('div');
  el.className = 'set-info';
  group.appendChild(el);
  const windows = /Windows/.test(navigator.userAgent);
  let last = '';
  const refresh = () => {
    const i = game.getGraphicsInfo();
    const kind = KIND_LABEL[i.gpuKind] || '';
    const q = QUALITY_LABEL[i.quality] || i.quality;
    const res = `${i.width} × ${i.height}` + (i.width !== i.nativeWidth || i.height !== i.nativeHeight ? ` <em>of ${i.nativeWidth} × ${i.nativeHeight}</em>` : ' <em>native</em>');
    let html = `<div title="${esc(i.renderer)}"><b>GPU</b>${esc(i.gpu)}${kind ? ` <em>· ${kind}</em>` : ''}</div>`
      + `<div><b>Render</b>${res} · ${i.msaa ? i.msaa + '× MSAA' : 'no MSAA'}${i.auto ? ` · Auto picked ${q}` : ''}</div>`;
    if (i.gpuKind === 'integrated' && windows) {
      html += '<div class="set-tip">Dedicated GPU in this PC? Set your browser to <b>High performance</b> in Windows Settings &gt; '
        + 'System &gt; Display &gt; Graphics, then restart the browser.</div>';
    }
    if (html !== last) {
      last = html;
      el.innerHTML = html;
    }
  };
  game.events.on('quality', refresh);
  game.events.on('resize', refresh);
  refresh();
  return refresh;
}
