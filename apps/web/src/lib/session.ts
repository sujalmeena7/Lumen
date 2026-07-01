import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { SessionData } from './types';

const sessionOptions = {
  password: process.env.SESSION_SECRET || 'super-secret-iron-session-password-at-least-32-chars',
  cookieName: 'ai_router_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
  },
};

export async function getSession() {
  const c = await cookies();
  return getIronSession<SessionData>(c, sessionOptions);
}
