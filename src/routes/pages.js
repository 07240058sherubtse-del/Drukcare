const express = require('express');
const { Op } = require('sequelize');
const { requireLogin } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { User, Hospital, Appointment, AppointmentSlot, Doctor } = require('../models');
const dzongkhags = require('../config/dzongkhags');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const hospitals = await Hospital.findAll({ limit: 6, order: [['isDemo', 'DESC'], ['name', 'ASC']] });
    return res.render('home', { hospitals, dzongkhags });
  } catch (error) {
    return next(error);
  }
});

router.get('/dashboard', requireLogin, async (req, res, next) => {
  try {
    const appointments = await Appointment.findAll({
      where: { userId: req.session.user.id },
      include: [
        { model: Hospital, as: 'hospital' },
        { model: Doctor, as: 'doctor' },
        { model: AppointmentSlot, as: 'slot' }
      ],
      order: [[{ model: AppointmentSlot, as: 'slot' }, 'startsAt', 'ASC']]
    });
    return res.render('patient/dashboard', {
      appointments,
      upcomingCount: appointments.filter((item) => item.slot.startsAt > new Date() && ['pending', 'confirmed'].includes(item.status)).length,
      totalCount: appointments.length,
      completedCount: appointments.filter((item) => item.status === 'completed').length,
      cancelledCount: appointments.filter((item) => item.status === 'cancelled').length,
      history: req.path.endsWith('/history')
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/appointments/history', requireLogin, async (req, res, next) => {
  try {
    const appointments = await Appointment.findAll({
      where: { userId: req.session.user.id },
      include: [
        { model: Hospital, as: 'hospital' },
        { model: Doctor, as: 'doctor' },
        { model: AppointmentSlot, as: 'slot' }
      ],
      order: [[{ model: AppointmentSlot, as: 'slot' }, 'startsAt', 'DESC']]
    });
    return res.render('patient/dashboard', {
      appointments,
      upcomingCount: appointments.filter((item) => item.slot.startsAt > new Date() && ['pending', 'confirmed'].includes(item.status)).length,
      totalCount: appointments.length,
      completedCount: appointments.filter((item) => item.status === 'completed').length,
      cancelledCount: appointments.filter((item) => item.status === 'cancelled').length,
      history: true
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/profile', requireLogin, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.session.user.id);
    return res.render('patient/profile', { dzongkhags, profile: user });
  } catch (error) {
    return next(error);
  }
});
router.post('/profile', requireLogin, async (req, res, next) => {
  try {
    if (!req.body.name?.trim() || req.body.name.length > 120 || !dzongkhags.includes(req.body.dzongkhag)) {
      return res.status(422).render('patient/profile', { dzongkhags, error: 'Enter a name and select a valid Dzongkhag.' });
    }
    await User.update({
      name: req.body.name.trim(),
      phone: String(req.body.phone || '').trim().slice(0, 30),
      dzongkhag: req.body.dzongkhag,
      address: String(req.body.address || '').trim().slice(0, 250) || null
    }, { where: { id: req.session.user.id } });
    req.session.user.name = req.body.name.trim();
    req.session.flash = { type: 'success', text: 'Your profile has been updated.' };
    return res.redirect('/profile');
  } catch (error) {
    return next(error);
  }
});

router.post('/profile/password',
  requireLogin,
  body('password').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/),
  body('confirmPassword').custom((value, { req }) => value === req.body.password),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) {
        req.session.flash = { type: 'danger', text: 'Use an 8+ character password with uppercase, lowercase, a number, a special character, and matching confirmation.' };
        return res.redirect('/profile');
      }
      const user = await User.findByPk(req.session.user.id);
      if (!await bcrypt.compare(req.body.currentPassword || '', user.passwordHash)) {
        req.session.flash = { type: 'danger', text: 'Your current password is incorrect.' };
        return res.redirect('/profile');
      }
      await user.update({ passwordHash: await bcrypt.hash(req.body.password, 12) });
      req.session.flash = { type: 'success', text: 'Your password has been updated.' };
      return res.redirect('/profile');
    } catch (error) {
      return next(error);
    }
  });

router.get('/about', (req, res) => res.render('pages/about'));
router.get('/contact', (req, res) => res.render('pages/contact'));

module.exports = router;
