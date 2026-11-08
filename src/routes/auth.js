const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, EmailToken } = require('../models');
const { sendEmail } = require('../services/email');
const dzongkhags = require('../config/dzongkhags');

const router = express.Router();
const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

function validationMessage(req) {
  const errors = validationResult(req);
  return errors.isEmpty() ? null : errors.array()[0].msg;
}

function tokenPair() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
}

async function createEmailToken(user, purpose) {
  const { token, tokenHash } = tokenPair();
  await EmailToken.create({
    userId: user.id,
    purpose,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });
  return token;
}

router.get('/register', (req, res) => res.render('auth/register', { dzongkhags }));
router.post('/register',
  body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Enter your full name.'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('phone').trim().isLength({ min: 6, max: 30 }).withMessage('Enter a valid phone number.'),
  body('dzongkhag').isIn(dzongkhags).withMessage('Select a Dzongkhag from the list.'),
  body('password').matches(passwordRule).withMessage('Password must be 8+ characters and include uppercase, lowercase, a number, and a special character.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'),
  async (req, res, next) => {
    try {
      const error = validationMessage(req);
      if (error) return res.status(422).render('auth/register', { dzongkhags, error, values: req.body });
      const email = req.body.email.toLowerCase();
      if (await User.findOne({ where: { email } })) {
        return res.status(409).render('auth/register', {
          dzongkhags, values: req.body, error: 'An account with that email address already exists.'
        });
      }
      const user = await User.create({
        name: req.body.name,
        email,
        phone: req.body.phone,
        dzongkhag: req.body.dzongkhag,
        address: req.body.address || null,
        passwordHash: await bcrypt.hash(req.body.password, 12)
      });
      const token = await createEmailToken(user, 'verify_email');
      const verificationUrl = `${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}/verify-email?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Verify your DrukCare email',
        text: `Hello ${user.name}, verify your email within one hour: ${verificationUrl}`
      });
      await new Promise((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, emailVerifiedAt: null };
      req.session.flash = { type: 'success', text: 'Account created. Follow the verification link sent to your email before booking.' };
      return res.redirect('/dashboard');
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).render('auth/register', {
          dzongkhags, values: req.body, error: 'An account with that email address already exists.'
        });
      }
      return next(error);
    }
  });

router.get('/verify-email', async (req, res, next) => {
  try {
    if (!req.query.token) return res.status(400).render('auth/verify', { error: 'Verification link is missing or invalid.' });
    const tokenHash = crypto.createHash('sha256').update(String(req.query.token)).digest('hex');
    const record = await EmailToken.findOne({
      where: { tokenHash, purpose: 'verify_email', usedAt: null }
    });

    if (!record || record.expiresAt < new Date()) {
      return res.status(400).render('auth/verify', { error: 'This verification link is invalid or expired. Please register again or contact support.' });
    }
    await User.update({ emailVerifiedAt: new Date() }, { where: { id: record.userId, emailVerifiedAt: null } });
    await record.update({ usedAt: new Date() });
    if (req.session.user?.id === record.userId) req.session.user.emailVerifiedAt = new Date();
    return res.render('auth/verify', { success: 'Your email is verified. You can now book appointments.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/resend-verification', async (req, res, next) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findByPk(req.session.user.id);
    if (!user || user.emailVerifiedAt) {
      req.session.flash = { type: 'info', text: 'Your email is already verified.' };
      return res.redirect('/dashboard');
    }
    const token = await createEmailToken(user, 'verify_email');
    const url = `${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}/verify-email?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: 'Verify your DrukCare email',
      text: `Hello ${user.name}, verify your email within one hour: ${url}`
    });
    req.session.flash = { type: 'success', text: 'A new verification link has been sent.' };
    return res.redirect('/dashboard');
  } catch (error) {
    return next(error);
  }
});

router.get('/login', (req, res) => res.render('auth/login'));
router.post('/login',
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('password').notEmpty().withMessage('Enter your password.'),
  async (req, res, next) => {
    try {
      const error = validationMessage(req);
      if (error) return res.status(422).render('auth/login', { error });
      const user = await User.findOne({ where: { email: req.body.email.toLowerCase() } });
      if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
        return res.status(401).render('auth/login', { error: 'Email or password is incorrect.' });
      }
      const returnTo = req.session.returnTo;
      await new Promise((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
      req.session.user = {
        id: user.id, name: user.name, email: user.email, role: user.role, emailVerifiedAt: user.emailVerifiedAt
      };
      const destination = user.role === 'admin' ? '/admin' : (returnTo || '/dashboard');
      return res.redirect(destination);
    } catch (error) {
      return next(error);
    }
  });

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('drukcare.sid');
    return res.redirect('/');
  });
});

router.get('/forgot-password', (req, res) => res.render('auth/forgot-password'));
router.post('/forgot-password',
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  async (req, res, next) => {
    try {
      const error = validationMessage(req);
      if (error) return res.status(422).render('auth/forgot-password', { error });
      const user = await User.findOne({ where: { email: req.body.email.toLowerCase() } });
      if (user) {
        const token = await createEmailToken(user, 'reset_password');
        const url = `${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}/reset-password?token=${token}`;
        await sendEmail({ to: user.email, subject: 'Reset your DrukCare password', text: `Reset your password within one hour: ${url}` });
      }
      return res.render('auth/forgot-password', {
        success: 'If an account exists for that email, a password reset link has been sent.'
      });
    } catch (error) {
      return next(error);
    }
  });

router.get('/reset-password', (req, res) => res.render('auth/reset-password', { token: req.query.token }));
router.post('/reset-password',
  body('password').matches(passwordRule).withMessage('Password must be 8+ characters and include uppercase, lowercase, a number, and a special character.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'),
  async (req, res, next) => {
    try {
      const error = validationMessage(req);
      if (error) return res.status(422).render('auth/reset-password', { token: req.body.token, error });
      const tokenHash = crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex');
      const record = await EmailToken.findOne({ where: { tokenHash, purpose: 'reset_password', usedAt: null } });
      if (!record || record.expiresAt < new Date()) {
        return res.status(400).render('auth/reset-password', { error: 'This password reset link is invalid or expired.' });
      }
      await User.update({ passwordHash: await bcrypt.hash(req.body.password, 12) }, { where: { id: record.userId } });
      await record.update({ usedAt: new Date() });
      return res.render('auth/login', { success: 'Password updated. Please log in.' });
    } catch (error) {
      return next(error);
    }
  });

module.exports = router;
