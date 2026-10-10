// Rotas de autenticação (/api/v1/auth) e /api/v1/me.
// Pipelines (pág. 08): auth pública → limiter → validate → controller;
// auth por cookie (refresh, logout) → limiter → csrfGuard → validate → controller.
import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { emptyBody, validate } from '../../shared/validation.js';
import * as controller from './auth.controller.js';
import {
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  verifyEmailBody,
} from './auth.validator.js';

export function createAuthRouter({ limiters, csrfGuard }) {
  const router = Router();

  router.post('/register', limiters.auth, validate({ body: registerBody }), controller.register);
  router.post('/login', limiters.loginIp, limiters.login, validate({ body: loginBody }), controller.login);
  router.post('/refresh', limiters.refresh, csrfGuard, validate({ body: emptyBody }), controller.refresh);
  router.post('/logout', csrfGuard, validate({ body: emptyBody }), controller.logout);
  router.post('/logout-all', authenticate, validate({ body: emptyBody }), controller.logoutAll);

  router.post('/password/forgot', limiters.auth, validate({ body: forgotPasswordBody }), controller.forgotPassword);
  router.post('/password/reset', limiters.auth, validate({ body: resetPasswordBody }), controller.resetPassword);
  router.post('/password/change', limiters.auth, authenticate, validate({ body: changePasswordBody }), controller.changePassword);

  router.post('/email/verify', limiters.auth, validate({ body: verifyEmailBody }), controller.verifyEmail);
  router.post('/email/resend', limiters.auth, authenticate, validate({ body: emptyBody }), controller.resendVerification);

  return router;
}

export function createMeRouter() {
  const router = Router();
  router.get('/', authenticate, controller.me);
  return router;
}
