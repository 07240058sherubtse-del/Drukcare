require('dotenv').config();
process.env.BASE_URL ||= process.env.RENDER_EXTERNAL_URL;
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { sequelize } = require('./models');
const { QueryTypes } = require('sequelize');
const pages = require('./routes/pages');
const auth = require('./routes/auth');
const directory = require('./routes/directory');
const appointments = require('./routes/appointments');
const admin = require('./routes/admin');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters.');
}
if (process.env.NODE_ENV === 'production') {
  let baseUrl;
  try {
    baseUrl = new URL(process.env.BASE_URL);
  } catch {
    throw new Error('Render public URL is missing. Set BASE_URL to your deployed HTTPS address.');
  }
  if (baseUrl.protocol !== 'https:') {
    throw new Error('BASE_URL must use HTTPS in production.');
  }
}

const app = express();
const sessionStore = new SequelizeStore({ db: sequelize, tableName: 'sessions' });
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.get('/healthz', async (req, res) => {
  try {
    await sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Health check could not reach PostgreSQL:', error);
    return res.status(503).json({ status: 'database unavailable' });
  }
});
app.use(helmet());
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (req.method !== 'GET' && req.method !== 'HEAD' && origin) {
    const expectedOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin !== expectedOrigin) {
      return res.status(403).render('error', {
        title: 'Request rejected',
        message: 'This request did not originate from DrukCare.'
      });
    }
  }
  return next();
});
app.use(session({
  name: 'drukcare.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.error = null;
  res.locals.success = null;
  res.locals.values = {};
  res.locals.token = null;
  res.locals.isDevelopment = process.env.NODE_ENV !== 'production';
  res.locals.formatBhutanDate = (date) => new Date(date).toLocaleString('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Thimphu'
  });
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please wait and try again.'
});
app.use(['/login', '/register', '/forgot-password', '/reset-password'], authLimiter);
app.use(pages);
app.use(auth);
app.use(directory);
app.use(appointments);
app.use('/admin', admin);

app.use((req, res) => res.status(404).render('error', {
  title: 'Page not found',
  message: 'The page you requested could not be found.'
}));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).render('error', {
    title: 'Something went wrong',
    message: process.env.NODE_ENV === 'production'
      ? 'We could not complete your request. Please try again later.'
      : error.message
  });
});

app.locals.sessionStore = sessionStore;
module.exports = app;
