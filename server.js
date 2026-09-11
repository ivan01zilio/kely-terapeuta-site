import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const indexFile = path.join(publicDir, 'index.html');
const adminFile = path.join(publicDir, 'admin.html');
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'submissions.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]', 'utf8');

app.use(express.json({ limit: '1mb' }));

function readLocalRows() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8') || '[]');
  } catch (err) {
    console.error('Local: erro ao ler submissions.json', err);
    return [];
  }
}

function writeLocalRows(rows) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(rows, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Local: erro ao salvar submissions.json', err);
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function leadSignature(item = {}) {
  const answers = Array.isArray(item.answers) ? item.answers : [];
  const labels = answers.map(a => String(a?.label || '')).join('|');
  return [
    String(item.name || '').trim().toLowerCase(),
    String(item.whatsapp || '').replace(/\D/g, ''),
    String(item.area || '').trim().toLowerCase(),
    Number(item.score || 0),
    labels.toLowerCase()
  ].join('::');
}

async function sendGoogleSheets(item, attempts = 3) {
  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK;
  const secret = process.env.GOOGLE_SHEETS_SECRET;

  if (!webhook || !secret) {
    console.log('Google Sheets: envio ignorado porque GOOGLE_SHEETS_WEBHOOK ou GOOGLE_SHEETS_SECRET nao foi configurado.');
    return false;
  }

  const payload = {
    secret,
    action: 'append',
    id: item.id,
    createdAt: item.createdAt,
    name: item.name,
    whatsapp: item.whatsapp,
    consent: item.consent,
    answers: item.answers,
    score: item.score,
    classification: item.classification,
    area: item.area
  };

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });

      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}

      if (!response.ok || (data && data.ok === false)) {
        throw new Error(`Google Sheets retornou ${response.status}: ${text.slice(0, 300)}`);
      }

      console.log(`Google Sheets: lead salvo com sucesso: ${item.id} (tentativa ${attempt})`);
      return true;
    } catch (err) {
      lastError = err;
      console.error(`Google Sheets: tentativa ${attempt}/${attempts} falhou para ${item.id}:`, err.message);
      if (attempt < attempts) await sleep(700 * attempt);
    }
  }

  throw lastError || new Error('Falha desconhecida ao salvar no Google Sheets');
}

async function loadGoogleSheetsRows(attempts = 2) {
  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK;
  const secret = process.env.GOOGLE_SHEETS_SECRET;
  if (!webhook || !secret) return null;

  const url = new URL(webhook);
  url.searchParams.set('action', 'list');
  url.searchParams.set('secret', secret);

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' });
      const text = await response.text();
      if (!response.ok) throw new Error(`Google Sheets leitura HTTP ${response.status}: ${text.slice(0, 300)}`);

      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error('Google Sheets leitura: resposta nao e JSON'); }

      const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : null);
      if (!rows) throw new Error('Google Sheets leitura: formato de resposta invalido');
      return rows;
    } catch (err) {
      lastError = err;
      console.error(`Google Sheets leitura: tentativa ${attempt}/${attempts} falhou:`, err.message);
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }

  throw lastError || new Error('Falha desconhecida ao ler Google Sheets');
}

async function syncLocalToGoogleSheets() {
  const localRows = readLocalRows();
  if (!localRows.length) return { synced: 0, skipped: 0 };

  let sheetRows;
  try {
    sheetRows = await loadGoogleSheetsRows();
  } catch (err) {
    console.error('Google Sheets: sincronizacao local adiada porque a leitura da planilha falhou:', err.message);
    return { synced: 0, skipped: localRows.length };
  }

  if (!sheetRows) return { synced: 0, skipped: localRows.length };

  const existing = new Set(sheetRows.map(leadSignature));
  let synced = 0;
  let skipped = 0;

  for (const item of localRows) {
    const sig = leadSignature(item);
    if (existing.has(sig)) {
      skipped++;
      continue;
    }
    try {
      await sendGoogleSheets(item, 2);
      existing.add(sig);
      synced++;
    } catch (err) {
      console.error('Google Sheets: nao foi possivel migrar lead local', item.id, err.message);
    }
  }

  if (synced) console.log(`Google Sheets: ${synced} lead(s) local(is) migrado(s) para armazenamento persistente.`);
  return { synced, skipped };
}

async function sendWhatsAppNotification(item) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = String(process.env.WHATSAPP_NOTIFY_TO || '5547996024629').replace(/\D/g, '');
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  if (!token || !phoneNumberId || !to) {
    console.log('WhatsApp: notificacao ignorada porque as variaveis ainda nao foram configuradas.');
    return;
  }

  const adminUrl = 'https://kelyterapeuta.online/admin';
  let payload;

  if (templateName) {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: String(item.name || 'Novo contato') },
            { type: 'text', text: String(item.whatsapp || 'Nao informado') },
            { type: 'text', text: String(item.area || 'Nao informada') },
            { type: 'text', text: String(item.classification || 'Nao informada') },
            { type: 'text', text: adminUrl }
          ]
        }]
      }
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: `🔔 Nova análise recebida\n\nNome: ${item.name}\nWhatsApp: ${item.whatsapp || 'Não informado'}\nÁrea: ${item.area}\nResultado: ${item.classification}\n\nVer respostas: ${adminUrl}`
      }
    };
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('WhatsApp: erro no envio', response.status, JSON.stringify(data));
    return;
  }
  console.log('WhatsApp: notificacao enviada com sucesso.', JSON.stringify(data));
}

function renderSite(res) {
  let html = fs.readFileSync(indexFile, 'utf8');
  html = html.replace('/Deixo%20Ir.mp3', '/Hoje%20Eu%20Escolho%20a%20Mim.mp3');
  const uiFixes = `
    .sound{display:none!important}
    .consent{display:none!important}

    .option,
    .option:hover,
    .option:active,
    .option:focus,
    .option:focus-visible{
      appearance:none!important;
      -webkit-appearance:none!important;
      background:#fff!important;
      border:1.5px solid var(--line)!important;
      color:var(--ink)!important;
      outline:none!important;
      box-shadow:none!important;
      transform:none!important;
      -webkit-tap-highlight-color:transparent!important;
    }

    .option.selected,
    .option.selected:hover,
    .option.selected:active,
    .option.selected:focus,
    .option.selected:focus-visible{
      background:var(--violet)!important;
      border-color:var(--violet)!important;
      color:#fff!important;
      box-shadow:0 6px 18px rgba(116,85,184,.22)!important;
      transform:translateY(-1px)!important;
    }

    .option::-moz-focus-inner{border:0!important}

    .ebookBox{
      margin:28px 0 10px;
      padding:24px;
      border-radius:22px;
      background:linear-gradient(135deg,#fff8ea,#f6ead0);
      border:1px solid #ead7aa;
      text-align:center;
      box-shadow:0 12px 30px rgba(101,76,22,.08);
    }
    .ebookBox .ebookTitle{
      font-family:'Playfair Display',serif;
      font-size:28px;
      line-height:1.15;
      color:#6f531b;
      margin:0 0 10px;
      font-weight:700;
    }
    .ebookBox .ebookText{
      margin:0 auto 18px;
      max-width:760px;
      color:#5e5960;
      font-size:16px;
      line-height:1.65;
    }
    .ebookBtn{
      display:block;
      width:100%;
      text-decoration:none;
      background:#b9892f;
      color:#fff!important;
      border-radius:17px;
      padding:17px 20px;
      font-weight:800;
      font-size:16px;
      box-shadow:0 8px 20px rgba(185,137,47,.24);
    }
    .ebookBtn:hover{background:#9f7424}
  `;
  html = html.replace('</style>', `${uiFixes}</style>`);
  html = html.replace(/<label class="consent"><input type="checkbox" id="consent"><span>.*?<\/span><\/label>/s, '');
  html = html.replace("if(!document.getElementById('consent').checked){document.getElementById('waErr').textContent='Marque a autorização para receber contato.';return}", '');
  html = html.replace('Concordo e quero continuar', 'Concordo e quero compartilhar');

  const oldHandler = "document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{const o=q.options[+b.dataset.i];state.answers[state.q]={label:o[0],score:o[1]};if(state.q===2)return whatsappStep();if(state.q===9)return finish();state.q++;renderQ()});const back=document.getElementById('back');";
  const newHandler = "document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{document.querySelectorAll('.option').forEach(x=>{x.classList.remove('selected');x.disabled=true});b.classList.add('selected');const o=q.options[+b.dataset.i];state.answers[state.q]={label:o[0],score:o[1]};setTimeout(()=>{if(state.q===2)return whatsappStep();if(state.q===9)return finish();state.q++;renderQ()},320)});const back=document.getElementById('back');";
  html = html.replace(oldHandler, newHandler);

  const ebookBlock = `<div class="ebookBox"><div class="ebookTitle">Aprofunde sua compreensão sobre o corte energético</div><p class="ebookText">Tenha acesso ao e-book que explica o passo a passo de como o corte energético pode contribuir para mudanças na sua vida, além dos detalhes sobre quem pode ou não realizar essa prática e de que forma você pode se beneficiar desse processo.</p><a class="ebookBtn" href="https://lastlink.com/p/CC318FB24/checkout-payment/" target="_blank" rel="noopener noreferrer">Quero acessar o e-book agora</a></div>`;
  html = html.replace('<button class="btn ghost" id="restart">Refazer análise</button>', `<button class="btn ghost" id="restart">Refazer análise</button>${ebookBlock}`);

  res.type('html').send(html);
}

app.get(['/', '/analise', '/analise/'], (req, res) => renderSite(res));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(adminFile));
app.use(express.static(publicDir, { index: false }));

app.post('/api/submissions', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || !Array.isArray(body.answers) || !body.classification || !body.area) {
      return res.status(400).json({ ok: false, error: 'Dados incompletos' });
    }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      name: String(body.name).slice(0, 140),
      whatsapp: String(body.whatsapp || '').slice(0, 40),
      consent: Boolean(body.consent),
      answers: body.answers,
      score: Number(body.score || 0),
      classification: String(body.classification).slice(0, 80),
      area: String(body.area).slice(0, 140)
    };

    // Cache local: util apenas como contingencia temporaria. O Google Sheets e o armazenamento persistente principal.
    const rows = readLocalRows();
    rows.push(item);
    const localSaved = writeLocalRows(rows);

    let sheetsSaved = false;
    try {
      sheetsSaved = await sendGoogleSheets(item, 3);
    } catch (err) {
      console.error('Google Sheets: FALHA CRITICA ao persistir lead', item.id, err.message);
    }

    sendWhatsAppNotification(item).catch(err => console.error('WhatsApp: falha inesperada', err));

    console.log(`Lead recebido: ${item.id} | cacheLocal=${localSaved} | persistenteSheets=${sheetsSaved}`);
    res.json({ ok: true, id: item.id, localSaved, sheetsSaved, durableSaved: sheetsSaved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Não foi possível salvar a análise.' });
  }
});

app.get('/api/admin/submissions', async (req, res) => {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return res.status(503).json({ ok: false, error: 'ADMIN_PASSWORD não configurada' });
  if (req.get('x-admin-password') !== configured) return res.status(401).json({ ok: false, error: 'Não autorizado' });

  try {
    const localRows = readLocalRows();
    let sheetRows = null;

    try {
      sheetRows = await loadGoogleSheetsRows();
      if (sheetRows) {
        console.log(`Google Sheets: ${sheetRows.length} leads persistentes carregados para o painel.`);
        // Tenta migrar para a planilha qualquer registro local que ainda nao esteja persistido.
        syncLocalToGoogleSheets().catch(err => console.error('Google Sheets: erro na sincronizacao em segundo plano', err));
      }
    } catch (err) {
      console.error('Google Sheets: leitura persistente indisponivel; usando apenas cache local nesta requisicao.', err.message);
    }

    const merged = [];
    const seen = new Set();

    for (const item of [...(sheetRows || []), ...localRows]) {
      const sig = leadSignature(item);
      if (seen.has(sig)) continue;
      seen.add(sig);
      merged.push(item);
    }

    merged.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.set('Cache-Control', 'no-store');
    res.set('X-Storage-Mode', sheetRows ? 'google-sheets+local-cache' : 'local-cache-only');
    res.json(merged);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Não foi possível carregar as análises.' });
  }
});

app.get('/api/admin/storage-status', async (req, res) => {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return res.status(503).json({ ok: false, error: 'ADMIN_PASSWORD não configurada' });
  if (req.get('x-admin-password') !== configured) return res.status(401).json({ ok: false, error: 'Não autorizado' });

  const localCount = readLocalRows().length;
  const sheetsConfigured = Boolean(process.env.GOOGLE_SHEETS_WEBHOOK && process.env.GOOGLE_SHEETS_SECRET);
  let sheetsReachable = false;
  let sheetsCount = null;
  let sheetsError = null;

  if (sheetsConfigured) {
    try {
      const rows = await loadGoogleSheetsRows(1);
      sheetsReachable = Array.isArray(rows);
      sheetsCount = Array.isArray(rows) ? rows.length : null;
    } catch (err) {
      sheetsError = err.message;
    }
  }

  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    persistentStorage: sheetsReachable,
    sheetsConfigured,
    sheetsReachable,
    sheetsCount,
    localCount,
    sheetsError
  });
});

app.get('*', (req, res) => renderSite(res));
app.listen(PORT, () => {
  console.log(`Kely Terapeuta online na porta ${PORT}`);
  if (process.env.GOOGLE_SHEETS_WEBHOOK && process.env.GOOGLE_SHEETS_SECRET) {
    console.log('Google Sheets: armazenamento persistente configurado.');
    setTimeout(() => {
      syncLocalToGoogleSheets().catch(err => console.error('Google Sheets: sincronizacao inicial falhou', err));
    }, 2500);
  } else {
    console.warn('Google Sheets: armazenamento persistente AINDA NAO configurado.');
  }
});
