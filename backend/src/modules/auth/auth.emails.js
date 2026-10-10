// E-mails da autenticação. Links sempre a partir de APP_URL; dados do usuário escapados no layout.
import { appLink, renderEmail } from '../email/templates.js';

function greeting(user) {
  const firstName = String(user.name).trim().split(/\s+/)[0];
  return `Olá, ${firstName}!`;
}

export function verifyEmailMessage(user, token) {
  return {
    to: user.email,
    template: 'auth.verify_email',
    ...renderEmail({
      subject: 'Confirme seu e-mail no ZEVS Nexus',
      greeting: greeting(user),
      paragraphs: ['Recebemos o cadastro da sua conta no ZEVS Nexus. Para confirmar que este e-mail é seu, use o botão abaixo.'],
      action: { label: 'Confirmar e-mail', url: appLink('/verificar-email', { token }) },
      footer: 'O link vale por 7 dias. Se você não fez esse cadastro, ignore esta mensagem.',
    }),
  };
}

export function accountExistsMessage(user) {
  return {
    to: user.email,
    template: 'auth.account_exists',
    ...renderEmail({
      subject: 'Tentativa de cadastro no ZEVS Nexus',
      greeting: greeting(user),
      paragraphs: [
        'Alguém (talvez você) tentou criar uma conta no ZEVS Nexus com este e-mail, mas ele já está cadastrado.',
        'Se esqueceu a senha, use "Esqueci minha senha" na tela de entrada.',
      ],
      action: { label: 'Entrar', url: appLink('/login') },
      footer: 'Se não foi você, nenhuma ação é necessária: sua conta continua protegida.',
    }),
  };
}

export function passwordResetMessage(user, token) {
  return {
    to: user.email,
    template: 'auth.password_reset',
    ...renderEmail({
      subject: 'Redefinição de senha do ZEVS Nexus',
      greeting: greeting(user),
      paragraphs: ['Recebemos um pedido para redefinir a senha da sua conta.'],
      action: { label: 'Redefinir senha', url: appLink('/redefinir-senha', { token }) },
      footer: 'O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu, ignore: sua senha continua a mesma.',
    }),
  };
}

export function passwordChangedMessage(user) {
  return {
    to: user.email,
    template: 'auth.password_changed',
    ...renderEmail({
      subject: 'Sua senha do ZEVS Nexus foi alterada',
      greeting: greeting(user),
      paragraphs: ['A senha da sua conta foi alterada e as outras sessões abertas foram encerradas.'],
      footer: 'Se não foi você, redefina a senha agora mesmo em "Esqueci minha senha", na tela de entrada.',
    }),
  };
}

export function sessionReuseAlertMessage(user) {
  return {
    to: user.email,
    template: 'auth.session_reuse_alert',
    ...renderEmail({
      subject: 'Alerta de segurança no ZEVS Nexus',
      greeting: greeting(user),
      paragraphs: [
        'Detectamos o uso de uma sessão antiga da sua conta. Por segurança, encerramos essa sessão em todos os dispositivos em que ela estava aberta.',
        'Se foi você em outro aparelho, basta entrar de novo. Se não reconhece o acesso, troque sua senha.',
      ],
      action: { label: 'Entrar', url: appLink('/login') },
    }),
  };
}
