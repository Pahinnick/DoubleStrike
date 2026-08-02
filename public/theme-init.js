// Set before first paint so switching themes doesn't flash dark first. Kept as an external file
// (not inline in index.html) so the CSP's script-src can stay 'self' only, no 'unsafe-inline'.
try {
  var t = localStorage.getItem('mtgdb:theme')
  if (t && t !== 'dark') document.documentElement.dataset.theme = t
} catch (e) {}
