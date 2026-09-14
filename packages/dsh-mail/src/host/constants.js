export const SETTINGS_NAMESPACE = 'dsh-mail-assistant'
export const PASSWORD_REF_NAME = 'DSH_MAIL_ASSISTANT_PASSWORD'
export const TOOL_NAMES = Object.freeze({
  folders: 'mail_list_folders',
  find: 'mail_find',
  read: 'mail_read',
  attachment: 'mail_get_attachment',
  send: 'mail_send',
})

export const DEFAULTS = Object.freeze({
  readEnabled: false,
  sendEnabled: false,
  email: '',
  username: '',
  fromName: '',
  inboxFolder: 'INBOX',
  imapHost: '',
  imapPort: 993,
  imapTls: 'implicit',
  smtpHost: '',
  smtpPort: 465,
  smtpTls: 'implicit',
  maxBodyChars: 20_000,
  maxMessageBytes: 25 * 1024 * 1024,
  maxAttachmentBytes: 20 * 1024 * 1024,
})
