// Shared scoreboard markup used by the in-game Tab overlay and the end-of-match screen.

import { TEAM_BLUE, TEAM_RED, TEAM_COLORS, TEAM_NAMES, isTeamMode } from '../core/constants.js';
import { esc, hexOf } from './dom.js';
import { ICON } from './Icons.js';

function kd(k, d) {
  return d <= 0 ? (k > 0 ? k.toFixed(2) : '0.00') : (k / d).toFixed(2);
}

/** Extra column of the objective modes: Escalation tier / King of the Hill seconds spent in the zone. */
function extraCell(r, mode) {
  if (mode === 'escalation') return `<span class="sb-t">${(r.tier | 0) + 1}</span>`;
  if (mode === 'koth') return `<span class="sb-t">${Math.round(r.zoneTime || 0)}s</span>`;
  return '';
}

function rowHTML(r, rank, opts, index) {
  const cls = ['sb-row'];
  if (r.isPlayer) cls.push('me');
  if (opts.dim && r.alive === false) cls.push('dead');
  return `<div class="${cls.join(' ')}" style="--i:${index}">`
    + `<span class="sb-rank">${rank}</span>`
    + `<span class="sb-chip" style="background:${esc(r.color)}"></span>`
    + `<span class="sb-name">${esc(r.name)}${r.isPlayer ? '' : `<em class="sb-ai">${ICON.bot}</em>`}</span>`
    + extraCell(r, opts.mode)
    + `<span class="sb-k">${r.kills}</span><span class="sb-d">${r.deaths}</span><span class="sb-kd">${kd(r.kills, r.deaths)}</span>`
    + '</div>';
}

function headHTML(mode) {
  const x = mode === 'escalation' ? '<span class="sb-t">TIER</span>' : mode === 'koth' ? '<span class="sb-t">HOLD</span>' : '';
  return '<div class="sb-row sb-head"><span class="sb-rank">#</span><span class="sb-chip"></span><span class="sb-name">PLAYER</span>'
    + x + '<span class="sb-k">K</span><span class="sb-d">D</span><span class="sb-kd">K/D</span></div>';
}

/**
 * Scoreboard table(s) for a set of rows (as returned by game.getScoreboard()).
 * FFA renders one table; TDM renders one block per team with the team total.
 * @param {Array} rows
 * @param {object} match  game.match (mode, teamScores)
 * @param {{dim?:boolean}} [opts]
 * @returns {string} html
 */
export function scoreboardHTML(rows, match, opts = {}) {
  const mode = match && match.mode;
  const HEAD = headHTML(mode);
  opts = { ...opts, mode };
  const xattr = mode === 'escalation' || mode === 'koth' ? ' data-x="1"' : '';
  if (!match || !isTeamMode(match.mode)) {
    let out = `<div class="sb-table"${xattr}>` + HEAD;
    rows.forEach((r, i) => { out += rowHTML(r, i + 1, opts, i); });
    return out + '</div>';
  }
  let out = '<div class="sb-teams">';
  for (const team of [TEAM_BLUE, TEAM_RED]) {
    const list = rows.filter(r => r.team === team);
    const col = hexOf(TEAM_COLORS[team]);
    const total = (match.teamScores && match.teamScores[team]) || 0;
    out += `<div class="sb-table sb-team"${xattr} style="--tc:${col}"><div class="sb-teamhead"><span>${esc(TEAM_NAMES[team] || 'Team')} team</span><b>${total}</b></div>${HEAD}`;
    list.forEach((r, i) => { out += rowHTML(r, i + 1, opts, i); });
    out += '</div>';
  }
  return out + '</div>';
}

/** Cheap change signature so the DOM is only rebuilt when something actually changed. */
export function scoreboardSignature(rows, match) {
  let s = match ? (match.teamScores ? match.teamScores[1] + ':' + match.teamScores[2] : '') : '';
  for (const r of rows) s += '|' + r.id + ',' + r.kills + ',' + r.deaths + ',' + (r.alive ? 1 : 0) + ',' + (r.tier | 0) + ',' + Math.round(r.zoneTime || 0);
  return s;
}
