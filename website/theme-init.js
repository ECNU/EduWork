// Apply the saved color before CSS paints. Storage may be disabled in private mode.
(() => {
  let theme = 'red';
  try { if (localStorage.getItem('eduwork-site-theme') === 'blue') theme = 'blue'; } catch {}
  document.documentElement.dataset.theme = theme;
})();
