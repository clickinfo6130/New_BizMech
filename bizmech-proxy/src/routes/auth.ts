/**
 * auth — placeholder auth endpoints.
 *
 * We don't have a real user directory yet. The proxy's job here is only to
 * keep the frontend contract alive. When the Java backend arrives, these
 * routes can be replaced with real JWT issuing + validation.
 */
import { Router } from 'express';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username_password_required' });
  }
  res.json({
    token: `proxy.${Buffer.from(String(username)).toString('base64')}.${Date.now()}`,
    user: {
      id: String(username),
      name: String(username),
      email: String(username).includes('@')
        ? username
        : `${username}@bizmech.local`,
      roles: ['user'],
    },
  });
});

router.get('/me', (req, res) => {
  const token = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token.startsWith('proxy.')) return res.json(null);
  try {
    const [, encoded] = token.split('.');
    const name = Buffer.from(encoded, 'base64').toString('utf8');
    res.json({ id: name, name, roles: ['user'] });
  } catch {
    res.json(null);
  }
});

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

export default router;
