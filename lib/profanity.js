// Small built-in word filter (whole words only, so real names are not caught).
const WORDS = new Set([
  'fuck', 'fucker', 'fucking', 'fucked', 'shit', 'shitty', 'cunt', 'bitch', 'bastard', 'cock',
  'pussy', 'whore', 'slut', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'asshole', 'wanker',
  'twat', 'dickhead', 'ponnaya', 'hutta', 'huththa', 'pakaya', 'kariya',
]);
export function isClean(text = '') {
  return !String(text).toLowerCase().split(/[^a-z]+/).some((w) => WORDS.has(w));
}
export function clean(text = '', max = 48) {
  return String(text).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
