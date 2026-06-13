const { config } = require('../config/environment');

function setSessionCookie(res, sessionToken) {
  res.cookie('sessionToken', sessionToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie('sessionToken', {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
    path: '/',
  });
}

module.exports = {
  setSessionCookie,
  clearSessionCookie,
};
