import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

const COOKIE_NAME = 'cb_session'
const password = process.env.APP_PASSWORD || ''
// 登录账号：默认 admin，可用 APP_USER 自定义
const username = process.env.APP_USER || 'admin'

if (!password) {
  console.error('[FATAL] 环境变量 APP_PASSWORD 未设置，请配置访问密码后再启动')
  process.exit(1)
}

// 弱密码检测：仅告警不阻止（家庭内网场景由用户自行决定），提醒改用强密码
const WEAK_PASSWORDS = new Set(['123456', '12345678', 'password', 'admin', 'demo888', '111111', 'qwerty', 'abc123'])
if (password.length < 10 || WEAK_PASSWORDS.has(password.toLowerCase()) || /^\d+$/.test(password)) {
  console.warn('[SECURITY] 当前 APP_PASSWORD 为弱密码（过短/纯数字/常见口令），建议换成 12 位以上、含大小写字母+数字+符号的强密码')
}

// 会话签名密钥：与登录密码解耦，避免 token 泄露后被离线爆破出密码。
// 持久化到 DATA_DIR/.session-secret，重启后已登录会话仍然有效；首次启动自动生成。
const sessionSecret = process.env.SESSION_SECRET || ''
if (!sessionSecret) console.warn('[SECURITY] 未设置 SESSION_SECRET，已自动生成随机密钥（若部署多实例请显式配置）')

// 会话有效期 7 天（原 30 天过长，降低 token 泄露后的暴露窗口）
const MAX_AGE = 7 * 24 * 60 * 60
let signingKey = sessionSecret

// 由 server 启动时注入持久化密钥（见 initSessionSecret）
export function initSessionSecret(secret) {
  if (typeof secret === 'string' && secret.length >= 16) signingKey = secret
}

function sign(expiry) {
  return createHmac('sha256', signingKey).update(String(expiry)).digest('hex')
}

// ===== 登录失败锁定（防暴力破解）=====
const MAX_FAILS = 5           // 连续失败 5 次
const LOCK_MS = 15 * 60 * 1000 // 锁定 15 分钟
const attempts = new Map()    // key: 客户端 IP → { fails, lockedUntil }

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown'
}

// 登录前检查：IP 是否处于锁定状态，返回剩余秒数（0 表示未锁定）
export function lockRemaining(req) {
  const rec = attempts.get(clientIp(req))
  if (!rec || !rec.lockedUntil) return 0
  const left = Math.ceil((rec.lockedUntil - Date.now()) / 1000)
  if (left <= 0) { attempts.delete(clientIp(req)); return 0 }
  return left
}

// 登录结果记录：成功清零；失败累加，达上限则锁定，返回本次失败后还需等待的秒数
export function recordLogin(req, success) {
  const ip = clientIp(req)
  if (success) { attempts.delete(ip); return 0 }
  const rec = attempts.get(ip) || { fails: 0, lockedUntil: 0 }
  rec.fails += 1
  if (rec.fails >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCK_MS
    rec.fails = 0
  }
  attempts.set(ip, rec)
  if (rec.lockedUntil) return Math.ceil((rec.lockedUntil - Date.now()) / 1000)
  return 0
}

// 失败后剩余可尝试次数（用于前端提示）
export function remainingFails(req) {
  const rec = attempts.get(clientIp(req))
  return rec ? Math.max(0, MAX_FAILS - rec.fails) : MAX_FAILS
}

export function makeToken() {
  const expiry = Math.floor(Date.now() / 1000) + MAX_AGE
  return `${expiry}.${sign(expiry)}`
}

export function verifyToken(token) {
  if (typeof token !== 'string') return false
  const [expiryStr, sig] = token.split('.')
  if (!expiryStr || !sig) return false
  const expiry = Number(expiryStr)
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false
  const expected = sign(expiry)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

export function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie)
  return verifyToken(cookies[COOKIE_NAME])
}

export function checkPassword(input) {
  if (typeof input !== 'string' || !input) return false
  const a = Buffer.from(input)
  const b = Buffer.from(password)
  return a.length === b.length && timingSafeEqual(a, b)
}

// 账号 + 密码校验（constant-time 比较账号，避免时序侧信道）
export function checkCredentials(user, input) {
  if (typeof user !== 'string' || !user) return false
  const a = Buffer.from(user)
  const b = Buffer.from(username)
  const userOk = a.length === b.length && timingSafeEqual(a, b)
  return userOk && checkPassword(input)
}

export function sessionCookie() {
  return `${COOKIE_NAME}=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}`
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
}

export function csrfToken() {
  return randomBytes(16).toString('hex')
}
