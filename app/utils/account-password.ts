import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '#shared/auth/password-policy'

// 仅提供建议，不提高现有账号的密码准入门槛，也不存储或发送输入。
export function passwordStrength(password: string) {
  if (!password) return { level: 0, label: '', hint: '' }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { level: 1, label: '长度不符合要求', hint: '请使用 6–128 个字符。' }
  }
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter(pattern => pattern.test(password)).length
  const repeated = /^(.)\1+$/u.test(password)
  const level = repeated || password.length < 10 || kinds < 2 ? 1 : password.length >= 14 && kinds >= 3 ? 3 : 2
  return { level, label: ['偏弱', '适中', '较强'][level - 1]!, hint: level < 3 ? '建议使用更长且不重复的密码，组合字母、数字或符号。' : '请避免使用在其他网站使用过的密码。' }
}
