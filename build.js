#!/usr/bin/env node
/*
 * build.js — membuat versi statis Bengkel Digital agar semua aplikasi terbaca Google.
 *
 * Cara pakai (butuh Node.js 18 ke atas, tanpa install paket apa pun):
 *   1. Taruh file ini satu folder dengan index.html
 *   2. Jalankan:   SITE_URL=https://alamat-website-anda.com node build.js
 *   3. Upload isi folder dist/ ke hosting (hasil build ada di sana)
 *
 * Yang dihasilkan di dist/:
 *   index.html                     halaman induk, daftar semua aplikasi sudah tertulis di HTML
 *   aplikasi/<nama-aplikasi>/      satu halaman untuk setiap aplikasi (bisa muncul sendiri di Google)
 *   tentang/, kontak/, kebijakan-privasi/, syarat-penggunaan/   halaman wajib untuk AdSense
 *   sitemap.xml, robots.txt        petunjuk untuk mesin pencari
 *
 * Variabel opsional: ADSENSE_CLIENT (ca-pub-...), CONTACT_EMAIL
 *
 * Konten tambahan (opsional, sangat dianjurkan untuk AdSense):
 *   artikel/*.md          tiap file jadi satu halaman di /artikel/<nama-file>/
 *   konten-aplikasi.json  penjelasan lengkap, untuk siapa, cara memulai, dan FAQ per aplikasi
 *
 * Jalankan ulang skrip ini setiap kali menambah, mengubah, atau menghapus aplikasi.
 */

const fs = require('fs');
const path = require('path');

/* ====== PENGATURAN ====== */
// GANTI dengan alamat asli website Anda (tanpa garis miring di akhir).
const SITE_URL = (process.env.SITE_URL || 'https://siakadsdntanjung-glitch.github.io/BENGKEL-DIGITAL').replace(/\/+$/, '');
const SITE_NAME = 'Aplikasi Sekolah';
const OWNER_NAME = 'Gordi_Vandi';
const CONTACT_PHONE = '085183859997';
const CONTACT_WA = '62' + CONTACT_PHONE.replace(/^0/, '');
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';     // opsional, contoh: nama@gmail.com
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || '';   // opsional, contoh: ca-pub-1234567890123456
// Ubah manual saat isi kebijakan berubah. Jangan pakai tanggal otomatis, supaya hasil build tidak berubah tiap hari.
const POLICY_DATE = '28 September 2026';
/* ======================== */

const SRC = path.join(__dirname, 'index.html');
const OUT = path.join(__dirname, 'dist');
const COLORS = ['teal', 'brass', 'rust', 'plum', 'steel', 'olive'];

const tpl = fs.readFileSync(SRC, 'utf8');
const projectId = process.env.FIREBASE_PROJECT_ID || (tpl.match(/projectId:\s*"([^"]+)"/) || [])[1];
const apiKey = process.env.FIREBASE_API_KEY || (tpl.match(/apiKey:\s*"([^"]+)"/) || [])[1];
const FIRESTORE = process.env.FIRESTORE_URL || 'https://firestore.googleapis.com';

/* ---------- Utilitas ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function norm(s) { return String(s || '').toLowerCase(); }
function colorOf(p) { return COLORS.indexOf(p.color) !== -1 ? p.color : 'teal'; }
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}
function jsonLd(obj) {
  return '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2).replace(/</g, '\\u003c') + '\n</script>';
}

/* Alamat halaman tiap aplikasi. Aturannya HARUS sama dengan yang ada di index.html. */
function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'aplikasi';
}
function assignSlugs(list) {
  const used = {};
  list.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((p) => {
    const base = slugify(p.title);
    let slug = base, n = 0;
    while (used[slug]) { n++; slug = base + '-' + slugify(p.id).slice(0, 6) + (n > 1 ? '-' + n : ''); }
    used[slug] = true;
    p.slug = slug;
  });
}

/* ---------- Ambil data dari Firestore (REST) ---------- */
function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(f) {
  const o = {};
  Object.keys(f).forEach((k) => { o[k] = decodeValue(f[k]); });
  return o;
}

async function fetchProducts() {
  if (!projectId || !apiKey) throw new Error('projectId/apiKey Firebase tidak ditemukan di index.html');
  const out = [];
  let token = '';
  do {
    const url = FIRESTORE + '/v1/projects/' + projectId + '/databases/(default)/documents/products' +
      '?pageSize=300&key=' + encodeURIComponent(apiKey) + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Firestore membalas ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const json = await res.json();
    (json.documents || []).forEach((d) => {
      const p = decodeFields(d.fields || {});
      p.id = d.name.split('/').pop();
      p.updated = (d.updateTime || '').slice(0, 10);
      out.push(p);
    });
    token = json.nextPageToken || '';
  } while (token);
  return out;
}

/* ---------- Potongan HTML ---------- */
// Harus menghasilkan struktur yang sama dengan cardHtml() di index.html.
function cardHtml(p) {
  const c = colorOf(p);
  const href = 'aplikasi/' + p.slug + '/';
  const first = p.links && p.links[0];
  const open = first
    ? '<a class="btn compact" style="background:var(--c-' + c + ');color:#fff;" href="' + esc(first.url) + '" target="_blank" rel="noopener">' + esc(first.label) + '</a>'
    : '<span class="btn compact disabled">Segera hadir</span>';
  return (
    '<article class="card" data-id="' + esc(p.id) + '" style="border-left-color:var(--c-' + c + ');">' +
      '<div class="card-head">' +
        '<div class="mark" style="background:var(--c-' + c + '-soft);color:var(--c-' + c + ');">' + esc(p.mark) + '</div>' +
        '<div class="card-title"><h2><a class="card-link" href="' + href + '">' + esc(p.title) + '</a></h2><div class="role">' + esc(p.role) + '</div></div>' +
      '</div>' +
      (p.desc ? '<p class="desc">' + esc(p.desc) + '</p>' : '') +
      '<div class="card-foot">' + open + '<a class="btn ghost detail-btn" href="' + href + '">Detail</a></div>' +
    '</article>'
  );
}

function replaceBetween(html, startMarker, endMarker, content) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker);
  if (a < 0 || b < a) throw new Error('Penanda ' + startMarker + ' ... ' + endMarker + ' tidak ditemukan di index.html');
  return html.slice(0, a + startMarker.length) + '\n' + content + '\n' + html.slice(b);
}

function homeSeo(list) {
  const url = SITE_URL + '/';
  const names = list.map((p) => p.title);
  let desc = SITE_NAME + ' menyediakan ' + (names.length ? names.slice(0, 3).join(', ') : 'aplikasi sekolah') +
    ', dan layanan sekolah lainnya — gratis, online, dan sudah dipakai sekolah dasar dari berbagai kecamatan, kabupaten, dan provinsi di Indonesia.';
  if (desc.length > 300) desc = desc.slice(0, 297).replace(/\s+\S*$/, '') + '…';
  const title = SITE_NAME + ' — Aplikasi Rapor Digital & Keuangan BOSP Sekolah Gratis';
  return [
    '<meta name="description" content="' + esc(desc) + '">',
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="id_ID">',
    '<meta property="og:site_name" content="' + esc(SITE_NAME) + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta name="twitter:card" content="summary">',
    adsHead(),
    jsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': url + '#org', name: SITE_NAME, url: url },
        { '@type': 'WebSite', '@id': url + '#website', url: url, name: SITE_NAME, inLanguage: 'id', publisher: { '@id': url + '#org' } },
        {
          '@type': 'ItemList',
          name: 'Daftar aplikasi ' + SITE_NAME,
          numberOfItems: list.length,
          itemListElement: list.map((p, idx) => ({
            '@type': 'ListItem', position: idx + 1, name: p.title, url: SITE_URL + '/aplikasi/' + p.slug + '/'
          }))
        }
      ]
    })
  ].join('\n');
}

/* ---------- Halaman satu aplikasi ---------- */
const styleBlock = (tpl.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const fontLinks = (tpl.match(/<link[^>]+fonts\.g[^>]*>/g) || []).join('\n');

const PAGE_CSS = `
<style>
  .app-page { max-width: 760px; padding: 36px 24px 24px; }
  .app-detail { background: var(--paper-raised); border: 1px solid var(--line); border-top-width: 4px; border-radius: 12px; padding: 30px; }
  .app-detail h1 { font-size: clamp(1.7rem, 4vw, 2.3rem); line-height: 1.2; }
  .app-detail .role { font-size: 0.95rem; color: var(--ink-soft); margin-top: 4px; }
  .app-detail .desc { margin: 20px 0 0; color: var(--ink-soft); max-width: 62ch; white-space: pre-line; }
  .app-detail .features { margin-top: 18px; }
  .others { margin-top: 40px; }
  .others h2 { font-size: 1.15rem; margin-bottom: 12px; }
  .others ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; }
  .others a { display: block; padding: 8px 0; color: var(--ink-soft); }
  .back { display: inline-block; margin-top: 28px; padding: 6px 0; color: var(--ink-soft); }
  .brand-link { text-decoration: none; }
  .auth-link { text-decoration: none; display: inline-block; }
  .section { margin-top: 28px; }
  .section h2 { font-size: 1.15rem; margin-bottom: 10px; }
  .section p, .section li { color: var(--ink-soft); max-width: 62ch; }
  .section ol { margin: 0; padding-left: 20px; }
  .section li { margin-bottom: 6px; }
  .section .prose { white-space: pre-line; }
  .faq dt { font-weight: 600; margin-top: 12px; color: var(--ink); }
  .faq dd { margin: 4px 0 0; color: var(--ink-soft); max-width: 62ch; }
  .doc { max-width: 760px; padding: 36px 24px 24px; }
  .doc h1 { font-size: clamp(1.7rem, 4vw, 2.3rem); line-height: 1.2; }
  .doc h2 { font-size: 1.15rem; margin: 28px 0 8px; }
  .doc p, .doc li { color: var(--ink-soft); max-width: 68ch; }
  .doc ul { padding-left: 20px; }
  .doc li { margin-bottom: 6px; }
  .foot-links { display: flex; flex-wrap: wrap; gap: 6px 18px; justify-content: center; padding: 20px 24px 0; font-size: 0.9rem; }
  .foot-links a { color: var(--ink-soft); padding: 6px 0; }
</style>`;

function appPage(p, all) {
  const c = colorOf(p);
  const url = SITE_URL + '/aplikasi/' + p.slug + '/';
  const title = p.title + (p.role ? ' — ' + p.role : '') + ' | ' + SITE_NAME;
  const desc = clip(p.desc || p.role || p.title, 155);
  const links = p.links && p.links.length
    ? p.links.map((l) => '<a class="btn" style="background:var(--c-' + c + ');color:#fff;" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>').join('')
    : '<span class="btn disabled">Tautan segera ditambahkan</span>';
  const features = p.features && p.features.length
    ? '<ul class="features">' + p.features.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '';

  // tautan ke aplikasi lain (membantu Google menemukan semua halaman)
  const idx = all.findIndex((x) => x.id === p.id);
  const others = all.filter((x) => x.id !== p.id);
  const start = others.length > 8 ? Math.min(idx, others.length - 8) : 0;
  const near = others.slice(start, start + 8);
  const othersHtml = near.length
    ? '<section class="others"><h2>Aplikasi lainnya</h2><ul>' +
      near.map((x) => '<li><a href="../' + x.slug + '/">' + esc(x.title) + '</a></li>').join('') + '</ul></section>'
    : '';

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      Object.assign({
        '@type': 'SoftwareApplication',
        name: p.title,
        description: p.desc || p.role || p.title,
        applicationCategory: 'WebApplication',
        url: url,
        inLanguage: 'id',
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL + '/' }
      }, p.role ? { alternateName: p.role } : {}),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: p.title, item: url }
        ]
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="id_ID">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
${fontLinks}
${adsHead()}
${jsonLd(ld)}
${styleBlock}${PAGE_CSS}
</head>
<body>
<header>
  <div class="wrap header-row">
    <a class="brand brand-link" href="../../">${esc(SITE_NAME)}</a>
    <div class="header-right"><a class="auth-link" href="../../">Semua aplikasi</a></div>
  </div>
</header>
<main class="wrap app-page">
  <article class="app-detail" style="border-top-color:var(--c-${c});">
    <div class="product-head-main">
      <div class="mark" style="background:var(--c-${c}-soft);color:var(--c-${c});">${esc(p.mark)}</div>
      <div><h1>${esc(p.title)}</h1><div class="role">${esc(p.role)}</div></div>
    </div>
    ${p.desc ? '<p class="desc">' + esc(p.desc) + '</p>' : ''}
    ${features}
    <div class="cta-row">${links}</div>
    ${appSections(p)}
  </article>
  ${othersHtml}
  <a class="back" href="../../">Lihat semua aplikasi</a>
</main>
${footerNav('../../')}
<footer class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(SITE_NAME)}</span>
  <span>Dibuat untuk memudahkan orang menemukan semua karya di satu alamat</span>
</footer>
</body>
</html>
`;
}

/* ---------- Bagian tambahan halaman aplikasi ---------- */
// Isi paling bagus datang dari Firestore. Field opsional per aplikasi:
//   body (teks panjang), audience (teks), steps (array teks), faq (array {q, a})
// Kalau field itu kosong, dipakai teks bawaan yang singkat.
function normFaq(list) {
  return (Array.isArray(list) ? list : []).map((x) => {
    if (x && typeof x === 'object') return { q: x.q || x.tanya || x.pertanyaan, a: x.a || x.jawab || x.jawaban };
    const parts = String(x || '').split('|');
    return { q: parts[0], a: parts.slice(1).join('|') };
  }).filter((x) => x.q && x.a);
}

function appSections(p) {
  const name = String(p.title || 'aplikasi');
  const audience = p.audience ||
    ('Aplikasi ini dapat dipakai oleh guru, operator, dan tenaga administrasi sekolah yang membutuhkan ' +
     (p.role ? String(p.role).toLowerCase() : 'bantuan pengelolaan data sekolah') + '.');
  const steps = Array.isArray(p.steps) && p.steps.length ? p.steps : [
    'Buka aplikasi lewat tombol di bagian atas halaman ini.',
    'Masuk atau daftar sesuai petunjuk di layar, bila aplikasi meminta akun.',
    'Ikuti menu yang tersedia untuk mengisi atau melihat data, lalu simpan pekerjaan Anda.'
  ];
  let faq = normFaq(p.faq);
  if (!faq.length) faq = [
    { q: 'Apakah ' + name + ' gratis?', a: 'Ya, aplikasi di ' + SITE_NAME + ' disediakan gratis.' },
    { q: 'Bagaimana jika saya mengalami kendala?', a: 'Hubungi pengelola lewat halaman Kontak dan sebutkan nama aplikasi serta kendala yang dialami.' }
  ];
  return (
    (p.body ? '<section class="section"><h2>Penjelasan lengkap</h2><p class="prose">' + esc(p.body) + '</p></section>' : '') +
    '<section class="section"><h2>Untuk siapa aplikasi ini</h2><p>' + esc(audience) + '</p></section>' +
    '<section class="section"><h2>Cara memulai</h2><ol>' + steps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol></section>' +
    '<section class="section"><h2>Pertanyaan umum</h2><dl class="faq">' +
      faq.map((x) => '<dt>' + esc(x.q) + '</dt><dd>' + esc(x.a) + '</dd>').join('') + '</dl></section>'
  );
}

/* ---------- Halaman statis: Tentang, Kontak, Kebijakan Privasi, Syarat ---------- */
const FOOT_CSS = '<style>.foot-links{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;padding:20px 24px 0;font-size:.9rem}.foot-links a{color:#5B6472;padding:6px 0}</style>';

function adsHead() {
  if (!/^ca-pub-\d+$/.test(ADSENSE_CLIENT)) return '';
  return '<meta name="google-adsense-account" content="' + ADSENSE_CLIENT + '">\n' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_CLIENT + '" crossorigin="anonymous"></script>';
}

let HAS_ARTICLES = false;
function footerNav(root) {
  return '<nav class="foot-links" aria-label="Tautan situs">' +
    (HAS_ARTICLES ? '<a href="' + root + 'artikel/">Artikel</a>' : '') +
    '<a href="' + root + 'tentang/">Tentang</a>' +
    '<a href="' + root + 'kontak/">Kontak</a>' +
    '<a href="' + root + 'kebijakan-privasi/">Kebijakan Privasi</a>' +
    '<a href="' + root + 'syarat-penggunaan/">Syarat Penggunaan</a></nav>';
}

function aboutMain(all) {
  const list = all.slice(0, 12).map((p) =>
    '<li><a href="../aplikasi/' + p.slug + '/">' + esc(p.title) + '</a>' + (p.role ? ' — ' + esc(p.role) : '') + '</li>').join('');
  return `<h1>Tentang ${esc(SITE_NAME)}</h1>
<p>${esc(SITE_NAME)} adalah kumpulan aplikasi berbasis web untuk membantu pekerjaan administrasi di sekolah, mulai dari rapor digital dan pengelolaan keuangan BOSP sampai undangan digital dan layanan sekolah lainnya. Saat ini tersedia ${all.length} aplikasi yang dapat dibuka lewat browser di HP maupun komputer.</p>
<h2>Tujuan</h2>
<p>Situs ini dibuat agar guru, operator, dan tenaga administrasi sekolah bisa menemukan semua aplikasi yang dibutuhkan di satu alamat, lengkap dengan penjelasan fungsi dan cara memulainya.</p>
<h2>Pengelola</h2>
<p>Situs dan aplikasi di dalamnya dikembangkan dan dikelola oleh ${esc(OWNER_NAME)}. Pertanyaan, saran, dan laporan kendala dapat disampaikan lewat halaman <a href="../kontak/">Kontak</a>.</p>
${list ? '<h2>Beberapa aplikasi</h2><ul>' + list + '</ul><p><a href="../">Lihat semua aplikasi</a></p>' : ''}`;
}

function contactMain() {
  return `<h1>Kontak</h1>
<p>Untuk pertanyaan penggunaan aplikasi, laporan kendala, atau saran, hubungi pengelola melalui:</p>
<ul>
<li>Telepon / WhatsApp: <a href="https://wa.me/${CONTACT_WA}" rel="noopener">${esc(CONTACT_PHONE)}</a></li>
${CONTACT_EMAIL ? '<li>Email: <a href="mailto:' + esc(CONTACT_EMAIL) + '">' + esc(CONTACT_EMAIL) + '</a></li>' : ''}
</ul>
<p>Agar cepat ditangani, sebutkan nama aplikasi, nama sekolah, dan kendala yang dialami (jika bisa, sertakan tangkapan layar).</p>`;
}

function privacyMain() {
  return `<h1>Kebijakan Privasi</h1>
<p>Terakhir diperbarui: ${POLICY_DATE}. Halaman ini menjelaskan data apa yang diproses ketika Anda mengunjungi ${esc(SITE_NAME)}.</p>
<h2>Statistik kunjungan</h2>
<p>Untuk mengetahui seberapa sering situs dipakai, halaman utama mencatat statistik kunjungan dalam bentuk jumlah gabungan, yaitu jenis perangkat, browser, sistem operasi, asal kunjungan, jam kunjungan, status pengunjung baru atau kembali, zona waktu, dan bahasa. Data ini tidak memuat nama, alamat email, atau nomor telepon pengunjung.</p>
<h2>Penyimpanan di browser</h2>
<p>Situs menyimpan penanda kecil di sessionStorage dan localStorage browser Anda agar kunjungan yang sama tidak dihitung berulang. Penanda ini dapat dihapus kapan saja lewat pengaturan browser.</p>
<h2>Akun pengelola</h2>
<p>Pengelola situs masuk memakai Firebase Authentication untuk menambah dan mengubah daftar aplikasi. Pengunjung umum tidak perlu membuat akun untuk membuka situs ini.</p>
<h2>Layanan pihak ketiga</h2>
<p>Situs ini memakai layanan Google Firebase untuk menyimpan data aplikasi dan statistik, Google Fonts untuk huruf, serta pustaka grafik dari jsDelivr atau cdnjs pada halaman utama. Layanan tersebut dapat menerima alamat IP dan informasi teknis browser Anda sesuai kebijakan masing-masing penyedia.</p>
<h2>Iklan</h2>
<p>Situs ini dapat menampilkan iklan dari Google AdSense. Google sebagai pihak ketiga menggunakan cookie untuk menayangkan iklan berdasarkan kunjungan Anda ke situs ini dan situs lain. Anda dapat memilih untuk tidak menerima iklan yang dipersonalisasi lewat <a href="https://adssettings.google.com" rel="noopener">Pengaturan Iklan Google</a>. Informasi lebih lanjut tersedia di <a href="https://policies.google.com/technologies/partner-sites" rel="noopener">kebijakan Google tentang penggunaan data</a>.</p>
<h2>Tautan ke situs lain</h2>
<p>Setiap halaman aplikasi memuat tautan ke aplikasi yang dibuka di alamat lain. Kebijakan privasi aplikasi tersebut berlaku di alamat masing-masing.</p>
<h2>Anak-anak</h2>
<p>Situs ini ditujukan untuk guru dan tenaga administrasi sekolah, dan tidak dengan sengaja mengumpulkan data pribadi anak-anak.</p>
<h2>Perubahan kebijakan</h2>
<p>Kebijakan ini dapat diperbarui sewaktu-waktu. Tanggal pembaruan terakhir tertera di bagian atas halaman.</p>
<h2>Pertanyaan</h2>
<p>Untuk pertanyaan tentang kebijakan ini, hubungi kami lewat halaman <a href="../kontak/">Kontak</a>.</p>`;
}

function termsMain() {
  return `<h1>Syarat Penggunaan</h1>
<p>Terakhir diperbarui: ${POLICY_DATE}. Dengan memakai ${esc(SITE_NAME)}, Anda menyetujui ketentuan berikut.</p>
<h2>Penggunaan layanan</h2>
<p>Aplikasi di situs ini disediakan gratis untuk keperluan administrasi dan pembelajaran di sekolah. Mohon gunakan dengan wajar dan tidak untuk tujuan yang melanggar hukum atau merugikan pihak lain.</p>
<h2>Data yang Anda masukkan</h2>
<p>Anda bertanggung jawab atas kebenaran data yang dimasukkan ke dalam aplikasi, termasuk menjaga kerahasiaan akun dan kata sandi Anda. Lakukan pencadangan data penting secara berkala.</p>
<h2>Ketersediaan</h2>
<p>Kami berusaha menjaga aplikasi tetap berjalan, tetapi tidak menjamin layanan selalu tersedia tanpa gangguan. Fitur dapat diubah atau dihentikan sewaktu-waktu.</p>
<h2>Hak cipta</h2>
<p>Tampilan, teks, dan kode situs ini dilindungi hak cipta ${esc(OWNER_NAME)}. Tautan ke situs ini boleh dibagikan, sedangkan penyalinan isi secara massal memerlukan izin.</p>
<h2>Kontak</h2>
<p>Pertanyaan tentang ketentuan ini dapat disampaikan lewat halaman <a href="../kontak/">Kontak</a>.</p>`;
}

const STATIC_PAGES = [
  { slug: 'tentang', title: 'Tentang Kami', desc: 'Tentang ' + SITE_NAME + ': kumpulan aplikasi web gratis untuk administrasi sekolah, dikelola oleh ' + OWNER_NAME + '.', main: aboutMain },
  { slug: 'kontak', title: 'Kontak', desc: 'Hubungi pengelola ' + SITE_NAME + ' untuk pertanyaan penggunaan aplikasi, laporan kendala, dan saran.', main: contactMain },
  { slug: 'kebijakan-privasi', title: 'Kebijakan Privasi', desc: 'Kebijakan privasi ' + SITE_NAME + ': data kunjungan, penyimpanan browser, layanan pihak ketiga, dan iklan.', main: privacyMain },
  { slug: 'syarat-penggunaan', title: 'Syarat Penggunaan', desc: 'Syarat dan ketentuan penggunaan aplikasi di ' + SITE_NAME + '.', main: termsMain }
];

function staticPage(pg, all) {
  const url = SITE_URL + '/' + pg.slug + '/';
  const title = pg.title + ' | ' + SITE_NAME;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: pg.title,
    url: url,
    inLanguage: 'id',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL + '/' }
  };
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(clip(pg.desc, 155))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="id_ID">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(clip(pg.desc, 155))}">
<meta property="og:url" content="${esc(url)}">
${fontLinks}
${adsHead()}
${jsonLd(ld)}
${styleBlock}${PAGE_CSS}
</head>
<body>
<header>
  <div class="wrap header-row">
    <a class="brand brand-link" href="../">${esc(SITE_NAME)}</a>
    <div class="header-right"><a class="auth-link" href="../">Semua aplikasi</a></div>
  </div>
</header>
<main class="wrap doc">
${pg.main(all)}
</main>
${footerNav('../')}
<footer class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(SITE_NAME)}</span>
  <span>Dikelola oleh ${esc(OWNER_NAME)}</span>
</footer>
</body>
</html>
`;
}

/* ---------- Konten tambahan aplikasi (konten-aplikasi.json) ---------- */
// Kunci boleh berupa alamat halaman (slug) atau judul aplikasi persis seperti di Firestore.
// Kunci yang diawali garis bawah (_) dianggap contoh dan diabaikan.
function mergeAppContent(products) {
  const file = path.join(__dirname, 'konten-aplikasi.json');
  if (!fs.existsSync(file)) return;
  let extra;
  try { extra = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('konten-aplikasi.json tidak valid: ' + e.message); }
  const used = {};
  products.forEach((p) => {
    const key = [p.slug, p.title, norm(p.title)].find((k) => extra[k] && typeof extra[k] === 'object');
    if (!key) return;
    used[key] = true;
    ['body', 'audience', 'steps', 'faq'].forEach((f) => {
      const empty = !p[f] || (Array.isArray(p[f]) && !p[f].length);
      if (empty && extra[key][f]) p[f] = extra[key][f];
    });
  });
  Object.keys(extra).filter((k) => k[0] !== '_' && !used[k]).forEach((k) => {
    console.warn('PERINGATAN: "' + k + '" di konten-aplikasi.json tidak cocok dengan aplikasi mana pun (cek ejaan judul).');
  });
}

/* ---------- Artikel (folder artikel/*.md) ---------- */
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function dateId(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? Number(m[3]) + ' ' + BULAN[Number(m[2]) - 1] + ' ' + m[1] : '';
}
function inlineMd(s) { // s sudah di-escape
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\.{1,2}\/[^)\s]*|\/[^)\s]*)\)/g, (m, t, u) =>
      '<a href="' + u + '"' + (/^https?:/.test(u) ? ' rel="noopener"' : '') + '>' + t + '</a>');
}
function mdToHtml(md) {
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { out.push('<p>' + inlineMd(esc(para.join(' '))) + '</p>'); para = []; } };
  const flushList = () => {
    if (list) { out.push('<' + list.t + '>' + list.items.map((i) => '<li>' + inlineMd(esc(i)) + '</li>').join('') + '</' + list.t + '>'); list = null; }
  };
  String(md).replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.trim();
    let m;
    if (!line) { flushPara(); flushList(); return; }
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) { flushPara(); flushList(); out.push('<h' + m[1].length + '>' + inlineMd(esc(m[2])) + '</h' + m[1].length + '>'); return; }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); return; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); return; }
    flushList(); para.push(line);
  });
  flushPara(); flushList();
  return out.join('\n');
}

// Format tiap file .md:
//   ---
//   judul: Judul artikel
//   deskripsi: Ringkasan satu kalimat (dipakai di Google)
//   tanggal: 2026-09-28
//   ---
//   ## Subjudul
//   Paragraf...
function loadArticles() {
  const dir = path.join(__dirname, 'artikel');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.md$/i.test(f)).map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const meta = {};
    let body = raw;
    if (m) {
      body = m[2];
      m[1].split(/\r?\n/).forEach((l) => { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); });
    }
    if (!meta.judul) { console.warn('PERINGATAN: artikel/' + f + ' dilewati karena baris "judul:" belum ada.'); return null; }
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < 300) console.warn('PERINGATAN: artikel/' + f + ' baru ' + words + ' kata; sebaiknya minimal 500 kata.');
    return {
      slug: slugify(meta.slug || f.replace(/\.md$/i, '')),
      title: meta.judul,
      desc: meta.deskripsi || clip(body.replace(/[#*\[\]()]/g, ''), 155),
      date: /^\d{4}-\d{2}-\d{2}$/.test(meta.tanggal || '') ? meta.tanggal : '',
      body: body,
      words: words
    };
  }).filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title, 'id')));
}

const ARTICLE_CSS = '<style>.doc ol{padding-left:20px}.doc h3{font-size:1rem;margin:20px 0 6px}.art-meta{font-size:.9rem;color:var(--ink-soft);margin:6px 0 20px}.art-list{list-style:none;padding:0}.art-list li{margin-bottom:18px}.art-list a{font-weight:600;color:var(--ink)}.art-list p{margin:4px 0 0}</style>';

function articlePage(a, list) {
  const url = SITE_URL + '/artikel/' + a.slug + '/';
  const title = a.title + ' | ' + SITE_NAME;
  const desc = clip(a.desc, 155);
  const others = list.filter((x) => x.slug !== a.slug).slice(0, 5);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.desc,
    inLanguage: 'id',
    mainEntityOfPage: url,
    author: { '@type': 'Person', name: OWNER_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL + '/' }
  };
  if (a.date) ld.datePublished = a.date;
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="id_ID">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${fontLinks}
${adsHead()}
${jsonLd(ld)}
${styleBlock}${PAGE_CSS}${ARTICLE_CSS}
</head>
<body>
<header>
  <div class="wrap header-row">
    <a class="brand brand-link" href="../../">${esc(SITE_NAME)}</a>
    <div class="header-right"><a class="auth-link" href="../">Artikel</a></div>
  </div>
</header>
<main class="wrap doc">
<article>
<h1>${esc(a.title)}</h1>
<p class="art-meta">${a.date ? esc(dateId(a.date)) + ' · ' : ''}${Math.max(1, Math.round(a.words / 200))} menit baca · Oleh ${esc(OWNER_NAME)}</p>
${mdToHtml(a.body)}
</article>
${others.length ? '<h2>Artikel lainnya</h2><ul>' + others.map((x) => '<li><a href="../' + x.slug + '/">' + esc(x.title) + '</a></li>').join('') + '</ul>' : ''}
<p><a href="../../">Lihat semua aplikasi</a></p>
</main>
${footerNav('../../')}
<footer class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(SITE_NAME)}</span>
  <span>Dikelola oleh ${esc(OWNER_NAME)}</span>
</footer>
</body>
</html>
`;
}

function articleIndexMain(list) {
  return '<h1>Artikel</h1>\n<p>Panduan praktis seputar administrasi sekolah, rapor, dan pengelolaan keuangan BOSP.</p>\n<ul class="art-list">' +
    list.map((a) => '<li><a href="' + a.slug + '/">' + esc(a.title) + '</a>' +
      (a.date ? '<br><small>' + esc(dateId(a.date)) + '</small>' : '') + '<p>' + esc(a.desc) + '</p></li>').join('') + '</ul>';
}

/* ---------- Jalankan ---------- */
async function main() {
  console.log('Mengambil data dari Firestore (' + projectId + ')...');
  const products = await fetchProducts();
  if (!products.length) throw new Error('Tidak ada aplikasi di koleksi "products". Build dibatalkan agar situs tidak menjadi kosong.');
  assignSlugs(products);
  products.sort((a, b) => norm(a.title).localeCompare(norm(b.title), 'id'));
  mergeAppContent(products);
  const articles = loadArticles();
  HAS_ARTICLES = articles.length > 0;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 0. Salin ads.txt (kalau ada) agar ikut ter-deploy ke Firebase Hosting
  const adsPath = path.join(__dirname, 'ads.txt');
  if (fs.existsSync(adsPath)) {
    fs.copyFileSync(adsPath, path.join(OUT, 'ads.txt'));
    console.log('ads.txt disalin ke dist/');
  }

  // 1. Halaman induk: daftar aplikasi sudah tertulis di HTML
  let home = replaceBetween(tpl, '<!--SEO:START-->', '<!--SEO:END-->', homeSeo(products));
  home = replaceBetween(home, '<!--APPS:START-->', '<!--APPS:END-->', products.map(cardHtml).join(''));
  home = home.replace('Copy Rigt', 'Copyright');
  home = home.replace('</head>', FOOT_CSS + '\n</head>');
  home = home.replace('<footer class="wrap">', footerNav('') + '\n<footer class="wrap">');
  fs.writeFileSync(path.join(OUT, 'index.html'), home);

  // 2. Satu halaman per aplikasi
  products.forEach((p) => {
    const dir = path.join(OUT, 'aplikasi', p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), appPage(p, products));
  });

  // 2b. Halaman statis (Tentang, Kontak, Kebijakan Privasi, Syarat)
  STATIC_PAGES.forEach((pg) => {
    const dir = path.join(OUT, pg.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), staticPage(pg, products));
  });

  // 2c. Artikel
  if (HAS_ARTICLES) {
    const idxDir = path.join(OUT, 'artikel');
    fs.mkdirSync(idxDir, { recursive: true });
    fs.writeFileSync(path.join(idxDir, 'index.html'), staticPage({
      slug: 'artikel', title: 'Artikel',
      desc: 'Panduan praktis seputar administrasi sekolah, rapor digital, dan pengelolaan keuangan BOSP.',
      main: () => articleIndexMain(articles)
    }, products).replace('</head>', ARTICLE_CSS + '\n</head>'));
    articles.forEach((a) => {
      const d = path.join(idxDir, a.slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'index.html'), articlePage(a, articles));
    });
  }

  // 3. sitemap.xml & robots.txt
  const today = new Date().toISOString().slice(0, 10);
  const newest = products.map((p) => p.updated).filter(Boolean).sort().pop() || today;
  const urls = [{ loc: SITE_URL + '/', lastmod: newest }].concat(
    STATIC_PAGES.map((pg) => ({ loc: SITE_URL + '/' + pg.slug + '/', lastmod: newest })),
    products.map((p) => ({ loc: SITE_URL + '/aplikasi/' + p.slug + '/', lastmod: p.updated || today })),
    HAS_ARTICLES ? [{ loc: SITE_URL + '/artikel/', lastmod: articles[0].date || today }] : [],
    articles.map((a) => ({ loc: SITE_URL + '/artikel/' + a.slug + '/', lastmod: a.date || today }))
  );
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + esc(u.loc) + '</loc><lastmod>' + u.lastmod + '</lastmod></url>').join('\n') +
    '\n</urlset>\n');
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

  const thin = products.filter((p) => !p.body).map((p) => p.title);
  if (thin.length) console.log('Catatan: ' + thin.length + ' aplikasi belum punya penjelasan lengkap (body) dan masih memakai teks bawaan: ' + thin.join(', '));
  console.log('Selesai: ' + products.length + ' aplikasi, ' + articles.length + ' artikel -> folder dist/');
  console.log('Alamat situs yang dipakai: ' + SITE_URL + (process.env.SITE_URL ? '' : '  (bawaan; ganti dengan SITE_URL=... jika salah)'));
}

main().catch((e) => { console.error('Build gagal: ' + e.message); process.exit(1); });
