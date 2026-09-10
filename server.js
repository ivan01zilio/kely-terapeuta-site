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

    /* Todas as alternativas entram neutras. */
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

    /* Só a alternativa tocada fica roxa por um instante antes de avançar. */
    .option.selected,
    .option.selected:hover,
    .option.selected:active,
    .option.selected:focus{
      background:var(--violetSoft)!important;
      border-color:var(--violet)!important;
      color:var(--navy)!important;
      box-shadow:0 0 0 1px rgba(116,85,184,.08)!important;
    }

    .option::-moz-focus-inner{border:0!important}
  `;
  html = html.replace('</style>', `${uiFixes}</style>`);
  html = html.replace(/<label class="consent"><input type="checkbox" id="consent"><span>.*?<\/span><\/label>/s, '');
  html = html.replace("if(!document.getElementById('consent').checked){document.getElementById('waErr').textContent='Marque a autorização para receber contato.';return}", '');
  html = html.replace('Concordo e quero continuar', 'Concordo e quero compartilhar');

  const oldHandler = "document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{const o=q.options[+b.dataset.i];state.answers[state.q]={label:o[0],score:o[1]};if(state.q===2)return whatsappStep();if(state.q===9)return finish();state.q++;renderQ()});const back=document.getElementById('back');";
  const newHandler = "document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{document.querySelectorAll('.option').forEach(x=>{x.classList.remove('selected');x.disabled=true});b.classList.add('selected');const o=q.options[+b.dataset.i];state.answers[state.q]={label:o[0],score:o[1]};setTimeout(()=>{if(state.q===2)return whatsappStep();if(state.q===9)return finish();state.q++;renderQ()},240)});const back=document.getElementById('back');";
  html = html.replace(oldHandler, newHandler);

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
