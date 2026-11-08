// Serves /recipe/:id — the app shell with recipe-specific Open Graph tags.
module.exports = async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = proto + '://' + host;
  const id = String((req.query && req.query.id) || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let shell;
  try { shell = await (await fetch(origin + '/')).text(); } catch (e) { res.status(502).send('App unavailable'); return; }
  let list = [];
  try { list = await (await fetch(origin + '/recipes/recipes.json')).json(); } catch (e) {}
  const r = list.find(x => x.id === id);
  let head = '';
  if (r) {
    const url = origin + '/recipe/' + r.id;
    const img = origin + '/' + (r.image || 'brand/favicon.png');
    const title = r.title + ' · THE 15 PROJECT';
    head += '<title>' + esc(title) + '</title>' +
      '<link rel="canonical" href="' + esc(url) + '">' +
      '<meta name="description" content="' + esc(r.description) + '">' +
      '<meta property="og:type" content="article">' +
      '<meta property="og:site_name" content="THE 15 PROJECT">' +
      '<meta property="og:title" content="' + esc(r.title) + '">' +
      '<meta property="og:description" content="' + esc(r.description) + '">' +
      '<meta property="og:url" content="' + esc(url) + '">' +
      '<meta property="og:image" content="' + esc(img) + '">' +
      '<meta property="og:image:width" content="800"><meta property="og:image:height" content="800">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta name="twitter:title" content="' + esc(r.title) + '">' +
      '<meta name="twitter:description" content="' + esc(r.description) + '">' +
      '<meta name="twitter:image" content="' + esc(img) + '">';
  } else {
    head += '<meta name="robots" content="noindex">';
  }
  const html = shell.replace(/<head>/i, '<head>' + head);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
  res.status(r ? 200 : 404).send(html);
};
