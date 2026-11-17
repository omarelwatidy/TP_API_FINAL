// Test rapide sans base de données : chargement, sécurité, validation, règles des modèles.
// Lancer avec : npm run smoke
process.env.MONGODB_URI ||= 'mongodb://localhost:27017/test';
process.env.JWT_SECRET ||= 'secret_de_test_suffisamment_long_123456';
process.env.ALLOWED_ORIGINS ||= 'http://localhost:5173';

const assert = (await import('node:assert/strict')).default;
const mongoose = (await import('mongoose')).default;
const { default: Server } = await import('../server.mjs');
const { default: registerModels } = await import('../models/index.mjs');
const { signToken } = await import('../middleware/auth.mjs');

const server = new Server();
server.models = registerModels(mongoose.createConnection());
server.security();
server.middleware();
server.routes();

const http = server.app.listen(0);
const base = `http://127.0.0.1:${http.address().port}`;

const call = async (method, path, { token, body, raw } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` })
    },
    body: raw ?? (body && JSON.stringify(body))
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
};

const id = '64b7f0c2a1b2c3d4e5f60718';
const token = signToken({ _id: id, role: 'user' });
let ok = 0;
const check = (name, cond) => { assert.ok(cond, name); ok += 1; console.log(`  ok  ${name}`); };

const routes = [];
server.app.router.stack.forEach((l) => l.route && Object.keys(l.route.methods).forEach((m) => routes.push(`${m.toUpperCase()} ${l.route.path}`)));
console.log(`${routes.length} routes chargées`);

// ---- Sécurité
let r = await call('GET', '/events');
check('sans token -> 401', r.status === 401 && r.json.message === 'Token manquant');
r = await call('GET', '/events', { token: `${token}x` });
check('token falsifié -> 401', r.status === 401 && r.json.message === 'Token invalide');
r = await call('GET', '/nope');
check('route inconnue -> 404', r.status === 404);
r = await call('POST', '/auth/login', { raw: '{bad json' });
check('JSON invalide -> 400', r.status === 400);
check('helmet actif', r.headers.get('x-content-type-options') === 'nosniff' && !r.headers.get('x-powered-by'));
check('rate limit actif', Boolean(r.headers.get('ratelimit') || r.headers.get('ratelimit-policy')));

// ---- Validation des données
r = await call('POST', '/auth/register', { body: { firstname: 'Jean', lastname: 'Dupont', email: 'jean@test.fr', password: 'abc' } });
check('mot de passe faible -> 422', r.status === 422 && r.json.errors[0].field === 'password');
r = await call('POST', '/auth/login', { body: { email: { $gt: '' }, password: 'x' } });
check('injection NoSQL refusée -> 422', r.status === 422);
r = await call('GET', '/events/pas-un-id', { token });
check('id invalide -> 400', r.status === 400);
r = await call('GET', '/events?from=hier', { token });
check('date invalide -> 400', r.status === 400);
r = await call('POST', '/events', { token, body: { name: 'Hi' } });
check('événement invalide -> 422 détaillé', r.status === 422 && r.json.errors.some((e) => e.field === 'startDate'));
r = await call('POST', '/threads', { token, body: { title: 'x', group: id, event: id } });
check('fil groupe + événement -> 422', r.status === 422);
r = await call('GET', '/albums', { token });
check('albums sans event -> 422', r.status === 422);

// ---- Règles des modèles
const {
  Event, Thread, Poll, ShoppingItem, User, Ticket
} = server.models;
const fails = async (doc) => { try { await doc.validate(); return false; } catch { return true; } };
const start = new Date('2026-12-01T20:00:00Z');
check('fin avant début refusée', await fails(new Event({ name: 'Fête', startDate: start, endDate: new Date('2026-12-01T10:00:00Z'), location: 'Paris' })));
check('billetterie sur événement privé refusée', await fails(new Event({ name: 'Fête', startDate: start, endDate: new Date('2026-12-02T01:00:00Z'), location: 'Paris', visibility: 'private', ticketingEnabled: true })));
check('fil sans parent refusé', await fails(new Thread({ title: 'x' })));
check('fil avec groupe ET événement refusé', await fails(new Thread({ title: 'x', group: id, event: id })));
check('fil avec un seul parent accepté', !(await fails(new Thread({ title: 'x', group: id }))));
check('sondage sans question refusé', await fails(new Poll({ event: id, title: 'abc', createdBy: id, questions: [] })));
check('question à 1 seule réponse refusée', await fails(new Poll({ event: id, title: 'abc', createdBy: id, questions: [{ text: 'Q', options: [{ label: 'a' }] }] })));
check('email invalide refusé', await fails(new User({ firstname: 'Jean', lastname: 'Dupont', email: 'nope', password: 'x' })));
check('billet sans adresse refusé', await fails(new Ticket({ event: id, ticketType: id, firstname: 'A', lastname: 'B', email: 'a@b.fr' })));
const item = new ShoppingItem({ event: id, user: id, name: '  Coca ', quantity: 2, arrivalTime: start });
await item.validate();
check('unicité : clé "coca" calculée', item.nameKey === 'coca');
const json = new User({ firstname: 'Jean', lastname: 'Dupont', email: 'a@b.fr', password: 'secret' }).toJSON();
check('le mot de passe n\'est jamais renvoyé', json.password === undefined && json.id !== undefined);

http.close();
console.log(`\n${ok} vérifications réussies`);
process.exit(0);
