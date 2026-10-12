function resolveLanguage(mode = 'auto', locale = 'en-US') {
  if (mode === 'zh' || mode === 'en') return mode;
  return /^zh(?:[-_]|$)/i.test(locale) ? 'zh' : 'en';
}

module.exports = { resolveLanguage };
