import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'submissions.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]', 'utf8');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Kely Terapeuta online na porta ${PORT}`));
