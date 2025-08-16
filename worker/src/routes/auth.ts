import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types';

import type { Bindings, Passkey } from '../types';
import { getOrCreateUser, getUser, getUserVerify} from '../lib/passkeys';

// Extend the Hono Bindings type to include the variables from wrangler.toml
type AuthBindings = Bindings;

const app = new Hono<{ Bindings: AuthBindings }>();

// Schema for the registration challenge request
const registerChallengeSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(3).max(50),
});

app.post('/register/simple', zValidator('json', registerChallengeSchema), async (c) => {
  if (!c.env.REGISTER_ENABLED) {
    return c.json({ error: `Registration is disabled` }, 400);
  }
  const { username, password } = c.req.valid('json');
  const { RP_NAME } = c.env;
  const exists = await getUser(c.env.DB, username, password);
  if (exists) {
    return c.json({ error: `User exists` }, 400);
  }
  const user = await getOrCreateUser(c.env.DB, username, password);
  const url = new URL(c.req.url);

  // If have env var RP_ID, read it, or use url.hostname
  const rpID = 'undefined' != typeof c.env.RP_ID && c.env.RP_ID ? c.env.RP_ID : url.hostname;

  // Create a session for the user
  const sessionToken = crypto.randomUUID();
  await c.env.KV_SESSIONS.put(`session:${sessionToken}`, user.id, { expirationTtl: 86400 });
  return c.json({
     verified: true, 
     rpName: RP_NAME,
     rpID,
     userID: user.id, // FIX: userID must be a BufferSource
     userName: user.username,
     token: sessionToken 
    });
});

app.post('/login/simple', zValidator('json', registerChallengeSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  const { RP_NAME } = c.env;
  const user = await getUserVerify(c.env.DB, username, password);
  if (!user) {
    return c.json({ error: `Login Failed` }, 400);
  }

  const url = new URL(c.req.url);
  // If have env var RP_ID, read it, or use url.hostname
  const rpID = 'undefined' != typeof c.env.RP_ID && c.env.RP_ID ? c.env.RP_ID : url.hostname;
  // Create a new session
  const sessionToken = crypto.randomUUID();
  await c.env.KV_SESSIONS.put(`session:${sessionToken}`, user.id, { expirationTtl: 86400 }); // 1 day
  return c.json({ 
    verified: true,
    rpName: RP_NAME,
    rpID,
    userID: user.id, // FIX: userID must be a BufferSource
    userName: user.username,
     token: sessionToken
     });

});

export default app;
