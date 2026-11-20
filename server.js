const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');
const STATUSES = ['new', 'clarify', 'work', 'done', 'rejected'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function validateRequest(b) {
  if (!['new', 'improve', 'bug'].includes(b.kind)) return 'Неверный тип задачи';
  if (!b.title || !String(b.title).trim()) return 'Укажите название задачи';
  if (!b.contact || !b.contact.name || !b.contact.dept || !b.contact.phone) {
    return 'Укажите контактное лицо';
  }
  return null;
}

// Роль и пользователь берутся из заголовков. Это замена авторизации (ТЗ, п. 10)
app.use('/api', (req, res, next) => {
  req.role = req.get('X-Role') === 'analyst' ? 'analyst' : 'employee'; // по умолчанию меньше прав
  req.user = req.get('X-User') || 'user1';
  next();
});

// Находит заявку и проверяет доступ: сотрудник видит только свои
function findAccessible(req, res) {
  const list = readData();
  const item = list.find((r) => r.id === req.params.id);
  if (!item || (req.role !== 'analyst' && item.author !== req.user)) {
    res.status(404).json({ error: 'Заявка не найдена' });
    return null;
  }
  return { list, item };
}

app.get('/api/requests', (req, res) => {
  let list = readData();
  if (req.role !== 'analyst') list = list.filter((r) => r.author === req.user);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // новые сверху
  res.json(list);
});

app.get('/api/requests/:id', (req, res) => {
  const found = findAccessible(req, res);
  if (found) res.json(found.item);
});

app.post('/api/requests', (req, res) => {
  if (req.role !== 'employee') {
    return res.status(403).json({ error: 'Заявки создаёт сотрудник' });
  }
  const err = validateRequest(req.body);
  if (err) return res.status(400).json({ error: err });

  const list = readData();
  const now = new Date().toISOString();
  const item = {
    ...req.body,
    id: crypto.randomUUID(),
    author: req.user,
    status: 'new',
    analystNote: '',
    createdAt: now,
    updatedAt: now
  };
  list.push(item);
  writeData(list);
  res.status(201).json(item);
});

// Автор меняет свою заявку целиком (ТЗ, п. 2 и 5)
app.put('/api/requests/:id', (req, res) => {
  if (req.role !== 'employee') {
    return res.status(403).json({ error: 'Аналитик не меняет содержание заявки' });
  }
  const found = findAccessible(req, res);
  if (!found) return;
  const { list, item } = found;

  if (!['new', 'clarify'].includes(item.status)) {
    return res.status(403).json({ error: 'Заявку нельзя изменить в этом статусе' });
  }
  const err = validateRequest(req.body);
  if (err) return res.status(400).json({ error: err });

  const updated = {
    ...req.body,
    id: item.id,
    author: item.author,
    createdAt: item.createdAt,
    analystNote: item.analystNote,
    reviewedAt: item.reviewedAt,
    reviewedBy: item.reviewedBy,
    status: 'new',                       // повторная отправка: снова «Новая»
    updatedAt: new Date().toISOString()
  };
  list[list.indexOf(item)] = updated;
  writeData(list);
  res.json(updated);
});

// Аналитик меняет только статус и комментарий
app.patch('/api/requests/:id', (req, res) => {
  if (req.role !== 'analyst') {
    return res.status(403).json({ error: 'Статус меняет аналитик' });
  }
  const found = findAccessible(req, res);
  if (!found) return;
  const { list, item } = found;

  const { status, analystNote } = req.body;
  const note = String(analystNote || '').trim();
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  if (status === 'rejected' && !note) {
    return res.status(400).json({ error: 'При отклонении укажите причину в комментарии' });
  }

  item.status = status;
  item.analystNote = note;
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = req.user;
  writeData(list);
  res.json(item);
});

app.listen(3000, () => console.log('http://localhost:3000'));