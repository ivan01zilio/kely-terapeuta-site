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
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: String(item.name || 'Novo contato') },
              { type: 'text', text: String(item.whatsapp || 'Nao informado') },
              { type: 'text', text: String(item.area || 'Nao informada') },
              { type: 'text', text: String(item.classification || 'Nao informada') },
              { type: 'text', text: adminUrl }
            ]
          }
        ]
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

app.post('/api/submissions', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || !Array.isArray(body.answers) || !body.classification || !body.area) {
      return res.status(400).json({ ok: false, error: 'Dados incompletos' });
    }
    const rows = JSON.parse(fs.readFileSync(dataFile, 'utf8') || '[]');
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
    rows.push(item);
    fs.writeFileSync(dataFile, JSON.stringify(rows, null, 2), 'utf8');

    sendWhatsAppNotification(item).catch(err => console.error('WhatsApp: falha inesperada', err));

    res.json({ ok: true, id: item.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Não foi possível salvar a análise.' });
  }
});

app.get('/api/admin/submissions', (req, res) => {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return res.status(503).json({ ok: false, error: 'ADMIN_PASSWORD não configurada' });
  if (req.get('x-admin-password') !== configured) return res.status(401).json({ ok: false, error: 'Não autorizado' });
  try {
    const rows = JSON.parse(fs.readFileSync(dataFile, 'utf8') || '[]');
    rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Não foi possível carregar as análises.' });
  }
});

app.get('*', (req, res) => renderSite(res));
app.listen(PORT, () => console.log(`Kely Terapeuta online na porta ${PORT}`));
