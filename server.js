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

function renderSite(res) {
  let html = fs.readFileSync(indexFile, 'utf8');
  const uiFixes = `
    .sound{display:none!important}.consent{display:none!important}
    .option,.option:hover,.option:active,.option:focus,.option:focus-visible{appearance:none!important;-webkit-appearance:none!important;background:#fff!important;border:1.5px solid var(--line)!important;color:var(--ink)!important;outline:none!important;box-shadow:none!important;transform:none!important;-webkit-tap-highlight-color:transparent!important}
    .option.selected,.option.selected:hover,.option.selected:active,.option.selected:focus,.option.selected:focus-visible{background:var(--violet)!important;border-color:var(--violet)!important;color:#fff!important;box-shadow:0 6px 18px rgba(116,85,184,.22)!important;transform:translateY(-1px)!important}.option::-moz-focus-inner{border:0!important}
    .ebookCta{margin:28px 0 10px;padding:24px;border-radius:22px;background:linear-gradient(135deg,#f6f1ff,#fff);border:1.5px solid rgba(116,85,184,.22);text-align:center;box-shadow:0 12px 30px rgba(47,35,84,.06)}
    .ebookCta .ebookTag{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--violet);margin-bottom:9px}.ebookCta h3{font-size:26px;margin-bottom:10px}.ebookCta p{font-size:16px;line-height:1.65;color:#525a6b;margin:0 auto 18px;max-width:760px}.ebookBtn{display:block;width:100%;padding:17px 20px;border-radius:17px;background:#d39a3a;color:#fff!important;text-decoration:none;font-weight:800;font-size:16px;box-shadow:0 8px 22px rgba(180,125,35,.22);transition:.2s ease}.ebookBtn:hover{transform:translateY(-1px);filter:brightness(.97)}
  `;
  html = html.replace('</style>', `${uiFixes}</style>`);
  html = html.replace(/<label class="consent"><input type="checkbox" id="consent"><span>.*?<\/span><\/label>/s, '');
  html = html.replace("if(!document.getElementById('consent').checked){document.getElementById('waErr').textContent='Marque a autorização para receber contato.';return}", '');
  html = html.replace('Concordo e quero continuar', 'Concordo e quero compartilhar');
  const oldHandler = "document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{const o=q.options[+b.dataset.i];state.answers[state.q]={label:o[0],score:o[1]};if(state.q===2)return whatsappStep();if(state.q===9)return finish();state.q++;renderQ()});const back=document.getElementById('back');";
  const newHandler = "document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{document.querySelectorAll('.option').forEach(x=>{x.classList.remove('selected');x.disabled=true});b.classList.add('selected');const o=q.options[+b.dataset.i];state.answers[state.q]={label:o[0],score:o[1]};setTimeout(()=>{if(state.q===2)return whatsappStep();if(state.q===9)return finish();state.q++;renderQ()},320)});const back=document.getElementById('back');";
  html = html.replace(oldHandler, newHandler);
  const ebookScript = `<script>(function(){const add=()=>{if(document.querySelector('.ebookCta'))return;const wa=document.querySelector('.wa');if(!wa)return;const box=document.createElement('div');box.className='ebookCta fade';box.innerHTML='<div class="ebookTag">Quer entender melhor o corte energético?</div><h3>Conheça o passo a passo</h3><p>Tenha acesso ao e-book que explica o passo a passo de como o corte energético pode contribuir para a sua vida, os detalhes de quem pode ou não realizar o processo e como você pode se beneficiar dessa experiência.</p><a class="ebookBtn" href="https://lastlink.com/p/CC318FB24/checkout-payment/" target="_blank" rel="noopener">Quero acessar o e-book agora</a>';const ghost=wa.parentElement.querySelector('.ghost');if(ghost)ghost.insertAdjacentElement('afterend',box);else wa.insertAdjacentElement('afterend',box)};new MutationObserver(add).observe(document.getElementById('app'),{childList:true,subtree:true});add()})();<\/script>`;
  html = html.replace('</body>', `${ebookScript}</body>`);
  res.type('html').send(html);
}

app.get(['/', '/analise', '/analise/'], (req, res) => renderSite(res));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(adminFile));
app.use(express.static(publicDir, { index: false }));
app.post('/api/submissions', (req, res) => {try {const body=req.body||{};if(!body.name||!Array.isArray(body.answers)||!body.classification||!body.area)return res.status(400).json({ok:false,error:'Dados incompletos'});const rows=JSON.parse(fs.readFileSync(dataFile,'utf8')||'[]');const item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString(),name:String(body.name).slice(0,140),whatsapp:String(body.whatsapp||'').slice(0,40),consent:Boolean(body.consent),answers:body.answers,score:Number(body.score||0),classification:String(body.classification).slice(0,80),area:String(body.area).slice(0,140)};rows.push(item);fs.writeFileSync(dataFile,JSON.stringify(rows,null,2),'utf8');res.json({ok:true,id:item.id})}catch(err){console.error(err);res.status(500).json({ok:false,error:'Não foi possível salvar a análise.'})}});
app.get('/api/admin/submissions',(req,res)=>{const configured=process.env.ADMIN_PASSWORD;if(!configured)return res.status(503).json({ok:false,error:'ADMIN_PASSWORD não configurada'});if(req.get('x-admin-password')!==configured)return res.status(401).json({ok:false,error:'Não autorizado'});try{const rows=JSON.parse(fs.readFileSync(dataFile,'utf8')||'[]');rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));res.set('Cache-Control','no-store');res.json(rows)}catch(err){console.error(err);res.status(500).json({ok:false,error:'Não foi possível carregar as análises.'})}});
app.get('*',(req,res)=>renderSite(res));
app.listen(PORT,()=>console.log(`Kely Terapeuta online na porta ${PORT}`));
