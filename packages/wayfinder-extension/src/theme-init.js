// Apply saved theme before first paint to prevent flash.
// Loaded as a regular <script> (not module) so it executes synchronously
// before the body renders.
chrome.storage.local.get(['theme']).then(({ theme = 'dark' }) => {
  if (theme === 'light')
    document.documentElement.setAttribute('data-theme', 'light');
  else if (
    theme === 'auto' &&
    !window.matchMedia('(prefers-color-scheme: dark)').matches
  )
    document.documentElement.setAttribute('data-theme', 'light');
  document.documentElement.setAttribute('data-theme-ready', '');
});
