// Lucide icons, kept in lib/icons.js so the app works offline
const isDark = () => document.documentElement.dataset.theme === 'dark';
const ic = name => `<svg class="lu" viewBox="0 0 24 24" aria-hidden="true">${(window.LUCIDE || {})[name] || ''}</svg>`;
const GALLERY_ICONS = { upright: 'panel-right', back: 'rectangle-vertical', door: 'door-closed', drawer: 'archive', leg: 'separator-vertical', rail: 'separator-horizontal', books: 'library', tallbooks: 'book-open', stack: 'book-copy', puzzle: 'puzzle', plant: 'sprout', bigplant: 'trees', vase: 'flower-2', frame: 'image', box: 'package', bottles: 'wine', fridge: 'refrigerator', tv: 'tv', monitor: 'monitor', laptop: 'laptop', lamp: 'lamp-desk', handle: 'grip-horizontal', wall: 'brick-wall', floor: 'grid-2x2' };
const addIcon = (el, name) => { if (el && !el.querySelector('.lu')) el.insertAdjacentHTML('afterbegin', ic(name)); };
// pointer events don't count clicks, so double-clicks are worked out here, before anything else sees the press
let lastPress = null;
window.addEventListener('pointerdown', e => {
  const now = performance.now();
  e.isDbl = !!lastPress && lastPress.b === e.button && now - lastPress.t < 400 && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
  lastPress = e.isDbl ? null : { t: now, x: e.clientX, y: e.clientY, b: e.button };
}, true);
