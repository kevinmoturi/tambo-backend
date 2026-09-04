import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import config from './config/config';
import authRoutes from './routes/auth.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';

const app = express();

/**
 * Must match the real deployment topology. Express uses this to decide whether
 * to believe X-Forwarded-For, and `req.ip` feeds the rate limiter - trusting a
 * proxy that is not there lets any client forge its own IP and bypass limits.
 */
app.set('trust proxy', config.trustProxy);

app.disable('x-powered-by');
app.use(helmet());

/**
 * Native mobile clients send no Origin header and are unaffected by CORS. This
 * only matters if a browser-based client (web dashboard, Expo web) is added, in
 * which case list its origins in CORS_ALLOWED_ORIGINS. Empty = deny all
 * browser origins, which is the safe default for a mobile-only API.
 */
app.use(
  cors({
    origin:
      config.cors.allowedOrigins.length > 0
        ? config.cors.allowedOrigins
        : false,
    credentials: false,
  }),
);

// Bodies are small JSON payloads; the cap blunts trivial memory-pressure attacks.
app.use(express.json({ limit: '100kb' }));

// --- Routes ----------------------------------------------------------------
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);

// --- Tail: unmatched routes, then the global error handler -----------------
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
