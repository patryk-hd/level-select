import { titleSearch } from './core.js';

export function showSearchSuggestions(anchor, games, query, onSelect) {
  const id = `${anchor.id}-search-suggestions`;
  let panel = document.getElementById(id);
  const suggestions = titleSearch(query).suggestions(games);
  if (!panel && !suggestions.length) return;
  if (!panel) {
    panel = document.createElement('section'); panel.id = id; panel.className = 'search-suggestions';
    panel.setAttribute('aria-label', 'Spelling suggestions'); anchor.before(panel);
  }
  panel.replaceChildren(); panel.hidden = !suggestions.length;
  if (!suggestions.length) return;
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  message.textContent = 'No direct title matches. Did you mean one of these?'; panel.append(message);
  const choices = document.createElement('div'); choices.className = 'search-suggestion-choices'; panel.append(choices);
  for (const { title } of suggestions) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
    button.onclick = () => onSelect(title); choices.append(button);
  }
}
