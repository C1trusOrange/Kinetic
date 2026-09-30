// Entry point. Installs error capture (used by the headless test harness), then boots the game.

const errors = [];
window.__ERRORS__ = errors;
const origConsoleError = console.error.bind(console);
console.error = (...args) => {
  try {
    errors.push(args.map(a => (a && a.stack) ? a.stack : String(a)).join(' '));
  } catch { /* ignore */ }
  origConsoleError(...args);
};
window.addEventListener('error', e => {
  errors.push(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  errors.push('Unhandled rejection: ' + (r && r.stack ? r.stack : String(r)));
});

function showFatal(err) {
  const el = document.createElement('div');
  el.className = 'fatal-error';
  el.textContent = 'KINETIC crashed while starting:\n\n' + (err && err.stack ? err.stack : String(err));
  document.body.appendChild(el);
}

async function start() {
  const { Game } = await import('./core/Game.js');
  const params = new URLSearchParams(location.search);
  const game = new Game(document.getElementById('game'), document.getElementById('ui'), params);
  window.__GAME__ = game;
  document.getElementById('boot-message')?.classList.add('hidden');
  await game.boot();
}

start().catch(err => {
  console.error(err);
  showFatal(err);
});
