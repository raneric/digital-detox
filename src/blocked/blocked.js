// Shows which domain triggered the block. The domain name comes from the
// query string set by the SiteBlocker redirect rule.
const el = document.getElementById('domain');
const domain = new URLSearchParams(window.location.search).get('domain');
if (domain) el.textContent = domain;
