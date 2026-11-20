const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

app.get('/api/requests', (req, res) => {
  res.json(readData());
});

app.post('/api/requests', (req, res) => {
  const b = req.body;

  // Сервер не доверяет клиенту: базовая проверка дублирует форму
  if (!['new', 'improve', 'bug'].includes(b.kind)) {
    return res.status(400).json({ error: 'Неверный тип задачи' });
  }
  if (!b.title || !b.title.trim()) {
    return res.status(400).json({ error: 'Укажите название задачи' });
  }
  if (!b.contact || !b.contact.name || !b.contact.dept || !b.contact.phone) {
    return res.status(400).json({ error: 'Укажите контактное лицо' });
  }

  const list = readData();
  const now = new Date().toISOString();
  const item = {
    ...b,
    id: crypto.randomUUID(),
    author: req.get('X-User') || 'anonymous',
    status: 'new',
    analystNote: '',
    createdAt: now,
    updatedAt: now
  };
  list.push(item);
  writeData(list);
  res.status(201).json(item);
});

app.listen(3000, () => console.log('http://localhost:3000'));