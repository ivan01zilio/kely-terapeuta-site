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
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'submissions.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]', 'utf8');

app.use(express.json({ limit: '1mb' }));

// Entrega a experiência com ajustes de interface aplicados no servidor.
function renderSite(res) {
  let html = fs.readFileSync(indexFile, 'utf8');
  const uiFixes = `
    .sound{display:none!important}
    .consent{display:none!important}
    .option,
    .option:hover,
    .option:active,
    .option:focus{
      background:#fff!important;
      border-color:var(--line)!important;
      box-shadow:none!important;
      -webkit-tap-highlight-color:transparent;
    }
    .option:focus-visible{
      outline:2px solid var(--violet);
      outline-offset:2px;
    }
    @media (hover:hover) and (pointer:fine){
      .option:hover{
        border-color:var(--violet)!important;
        background:var(--violetSoft)!important;
      }
    }
  `;
  html = html.replace('</style>', `${uiFixes}</style>`);
  html = html.replace(/<label class="consent"><input type="checkbox" id="consent"><span>.*?<\/span><\/label>/s, '');
  html = html.replace("if(!document.getElementById('consent').checked){document.getElementById('waErr').textContent='Marque a autorização para receber contato.';return}", '');
  html = html.replace('Concordo e quero continuar', 'Concordo e quero compartilhar');
  res.type('html').send(html);
}

app.get(['/', '/analise', '/analise/'], (req, res) => renderSite(res));
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
    res.json({ ok: true, id: item.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Não foi possível salvar a análise.' });
  }
});

app.get('*', (req, res) => renderSite(res));
app.listen(PORT, () => console.log(`Kely Terapeuta online na porta ${PORT}`));
