// Skupni gradniki za prikaz drevesa kategorij.

import { topCategories, childrenOf } from './store.js';
import { esc } from './ui.js';

const KIND_GROUPS = { expense: 'Stroški', income: 'Prihodki', transfer: 'Prenosi' };

const option = (c, selected, isSub) =>
  `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${isSub ? '   ↳ ' : ''}${esc(c.emoji)} ${esc(c.name)}</option>`;

/** <option> elementi za <select>: glavne kategorije, pod njimi zamaknjene podkategorije, ločeno po vrsti. */
export function categoryOptions(selected, kinds = Object.keys(KIND_GROUPS)) {
  return kinds.map(kind => `<optgroup label="${KIND_GROUPS[kind]}">${topCategories(kind)
    .map(c => option(c, selected, false) + childrenOf(c.id).map(s => option(s, selected, true)).join(''))
    .join('')}</optgroup>`).join('');
}
