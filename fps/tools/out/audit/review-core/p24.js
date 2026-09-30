// startMatch with unvalidated (stale) persisted settings: does it recover?
const out = {};
await sleep(500);
const errs0 = report.errors.length;
game.settings.data.difficulty = 'nightmare';   // as if loaded from an old localStorage (Settings.load only checks typeof)
game.settings.data.mode = 'zzz';
let thrown = null;
try { await game.startMatch({ mapId: 'sandbox', botCount: 2, scoreLimit: 0, timeLimit: 0, difficulty: undefined, mode: undefined }); } catch (e) { thrown = String(e && e.message || e); }
await sleep(500);
out.thrown = thrown;
out.state = game.state;
out.starting = game._starting;
out.matchExists = !!game.match;
out.newErrors = report.errors.slice(errs0).map(s => s.split('\n')[0]).slice(0, 4);
out.overlayVisible = (() => { const el = document.querySelector('#ui [class*=loading]'); return el ? getComputedStyle(el).display + '/' + getComputedStyle(el).opacity : null; })();
game.settings.data.difficulty = 'normal'; game.settings.data.mode = 'ffa';
return out;
