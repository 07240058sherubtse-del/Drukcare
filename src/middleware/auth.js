function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//') && !req.originalUrl.includes('\\')) {
      req.session.returnTo = req.originalUrl;
    }
    req.session.flash = { type: 'info', text: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  return next();
}

function requireVerified(req, res, next) {
  if (!req.session.user?.emailVerifiedAt) {
    req.session.flash = { type: 'warning', text: 'Verify your email address before booking an appointment.' };
    return res.redirect('/dashboard');
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'This page is available to administrators only.'
    });
  }
  return next();
}

module.exports = { requireLogin, requireVerified, requireAdmin };
