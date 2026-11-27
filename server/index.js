import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initDb, listBinders, createBinder, getBinder, updateBinder, deleteBinder, updateBinderAvatar,
  listPages, createPage, getPage, updatePage, deletePage, reorderPages
} from './db.js'
import {
  isAuthenticated, checkCredentials, sessionCookie, clearCookie,
  initSessionSecret, lockRemaining, recordLogin, remainingFails
} from './auth.js'
import { randomBytes } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 31688
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const AVATAR_DIR = path.join(DATA_DIR, 'avatars')
const DIST_DIR = path.join(__dirname, '..', 'frontend', 'dist')

fs.mkdirSync(UPLOAD_DIR, { recursive: true })
fs.mkdirSync(AVATAR_DIR, { recursive: true })
initDb(DATA_DIR)

// 会话签名密钥：持久化到数据目录，重启后已登录会话不失效；token 不再依赖登录密码签名
const SECRET_FILE = path.join(DATA_DIR, '.session-secret')
function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim()
    if (existing.length >= 32) return initSessionSecret(existing)
  } catch {}
  const generated = randomBytes(32).toString('hex')
  try { fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 }) } catch (e) {
    console.warn('[SECURITY] 无法持久化会话密钥，重启后需重新登录:', e.message)
  }
  initSessionSecret(generated)
}
loadSessionSecret()

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

// 上传白名单：图片 / PDF / 常见文档（ARM 上不做缩略图重处理，交给浏览器）
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'])
const MAX_FILE_SIZE = 80 * 1024 * 1024 // 80MB

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const binderId = req.params.id
    const dir = path.join(UPLOAD_DIR, binderId)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${randomUUID()}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 20 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('不支持的文件类型: ' + ext))
    cb(null, true)
  }
})

function safeName(name) {
  return String(name || '').replace(/[\r\n\t"<>]/g, ' ').slice(0, 200).trim()
}

// 就诊日期校验：只接受 YYYY-MM-DD，避免脏数据混入时间轴
function safeDate(v) {
  const s = String(v || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

// 数值字段：允许留空，否则只接受合理范围的数字
function safeNumber(v, { min = 0, max = 300 } = {}) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

// 头像专用上传：单张图片，固定存到 avatars 目录，文件名用 binder id + 图片扩展名
const AVATAR_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const avatarStorage = multer.diskStorage({
  destination(req, file, cb) { cb(null, AVATAR_DIR) },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${req.params.id}${ext}`)
  }
})
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!AVATAR_EXT.has(ext)) return cb(new Error('头像仅支持 JPG/PNG/WebP/GIF/BMP 图片'))
    cb(null, true)
  }
})

function avatarUrl(binder) {
  return binder?.avatar ? `/api/avatars/${binder.id}` : ''
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: '未登录' })
  next()
}

function asyncRoute(fn) {
  return (req, res) => {
    try {
      const out = fn(req, res)
      if (out && typeof out.then === 'function') out.catch(e => {
        console.error('[API ERROR]', e)
        if (!res.headersSent) res.status(500).json({ error: '服务器内部错误' })
      })
    } catch (e) {
      console.error('[API ERROR]', e)
      if (!res.headersSent) res.status(500).json({ error: '服务器内部错误' })
    }
  }
}

// ---------- 鉴权 ----------
app.post('/api/login', (req, res) => {
  // 先检查该 IP 是否处于失败锁定状态（防暴力破解）
  const lockedFor = lockRemaining(req)
  if (lockedFor > 0) {
    return res.status(429).json({ error: `尝试次数过多，已临时锁定，请 ${Math.ceil(lockedFor / 60)} 分钟后再试` })
  }
  const ok = checkCredentials(req.body?.username, req.body?.password)
  const waitFor = recordLogin(req, ok)
  if (!ok) {
    if (waitFor > 0) return res.status(429).json({ error: `连续输错 5 次，账号临时锁定 15 分钟，请稍后再试` })
    return res.status(401).json({ error: `账号或密码错误，还可尝试 ${remainingFails(req)} 次` })
  }
  res.setHeader('Set-Cookie', sessionCookie())
  res.json({ ok: true })
})

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearCookie())
  res.json({ ok: true })
})

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) })
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'care-binder', arch: process.arch })
})

// ---------- 资料册（按家人分册）----------
// 给资料册附带头像访问地址
function withAvatar(b) {
  return { ...b, avatar_url: avatarUrl(b) }
}

app.get('/api/binders', requireAuth, asyncRoute((req, res) => {
  res.json(listBinders().map(withAvatar))
}))

app.post('/api/binders', requireAuth, asyncRoute((req, res) => {
  const name = safeName(req.body?.name)
  if (!name.trim()) return res.status(400).json({ error: '家人姓名不能为空' })
  res.status(201).json(withAvatar(createBinder({
    name: name.trim(),
    relation: safeName(req.body?.relation),
    color: /^#[0-9a-fA-F]{6}$/.test(req.body?.color) ? req.body.color : '#7c9cbf',
    age: safeNumber(req.body?.age, { min: 0, max: 130 }),
    height: safeNumber(req.body?.height, { min: 20, max: 260 }),
    weight: safeNumber(req.body?.weight, { min: 1, max: 500 })
  })))
}))

app.put('/api/binders/:id', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  if (!getBinder(id)) return res.status(404).json({ error: '资料册不存在' })
  const name = safeName(req.body?.name)
  if (!name.trim()) return res.status(400).json({ error: '家人姓名不能为空' })
  res.json(withAvatar(updateBinder(id, {
    name: name.trim(),
    relation: safeName(req.body?.relation),
    color: /^#[0-9a-fA-F]{6}$/.test(req.body?.color) ? req.body.color : '#7c9cbf',
    age: safeNumber(req.body?.age, { min: 0, max: 130 }),
    height: safeNumber(req.body?.height, { min: 20, max: 260 }),
    weight: safeNumber(req.body?.weight, { min: 1, max: 500 })
  })))
}))

app.delete('/api/binders/:id', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  if (!getBinder(id)) return res.status(404).json({ error: '资料册不存在' })
  deleteBinder(id)
  fs.rmSync(path.join(UPLOAD_DIR, String(id)), { recursive: true, force: true })
  // 清理该家人的头像（所有可能扩展名）
  for (const f of fs.readdirSync(AVATAR_DIR)) {
    if (new RegExp(`^${id}\\.[a-z]+$`).test(f)) fs.rmSync(path.join(AVATAR_DIR, f), { force: true })
  }
  res.json({ ok: true })
}))

// ---------- 家人头像 ----------
app.post('/api/binders/:id/avatar', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  if (!getBinder(id)) return res.status(404).json({ error: '资料册不存在' })
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '头像不能超过 8MB' })
      return res.status(400).json({ error: err.message || '头像上传失败' })
    }
    if (!req.file) return res.status(400).json({ error: '请选择头像图片' })
    try {
      // 先删除旧头像（不同扩展名），再记录新文件名
      for (const f of fs.readdirSync(AVATAR_DIR)) {
        if (new RegExp(`^${id}\\.[a-z]+$`).test(f) && f !== req.file.filename) {
          fs.rmSync(path.join(AVATAR_DIR, f), { force: true })
        }
      }
      const b = updateBinderAvatar(id, req.file.filename)
      res.json(withAvatar(b))
    } catch (e) {
      console.error('[AVATAR ERROR]', e)
      res.status(500).json({ error: '保存头像失败' })
    }
  })
})

app.get('/api/avatars/:id', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  const binder = getBinder(id)
  if (!binder?.avatar) return res.status(404).send('头像不存在')
  const file = path.join(AVATAR_DIR, path.basename(binder.avatar))
  if (!fs.existsSync(file)) return res.status(404).send('头像文件已丢失')
  const ext = path.extname(file).toLowerCase()
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' }[ext] || 'application/octet-stream'
  res.setHeader('Content-Type', mime)
  res.setHeader('Cache-Control', 'public, max-age=3600')
  fs.createReadStream(file).pipe(res)
}))

// ---------- 病历页 ----------
app.get('/api/binders/:id/pages', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  if (!getBinder(id)) return res.status(404).json({ error: '资料册不存在' })
  res.json(listPages(id))
}))

app.post('/api/binders/:id/pages', requireAuth, (req, res) => {
  const binderId = Number(req.params.id)
  if (!getBinder(binderId)) return res.status(404).json({ error: '资料册不存在' })
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '单个文件不能超过 80MB' })
      return res.status(400).json({ error: err.message || '上传失败' })
    }
    try {
      const title = safeName(req.body?.title)
      const note = safeName(req.body?.note)
      const department = safeName(req.body?.department) || '未分类'
      const visitDate = safeDate(req.body?.visit_date)
      const files = (req.files || []).map(f => createPage({
        binder_id: binderId,
        title: title || f.originalname,
        note,
        department,
        visit_date: visitDate,
        filename: f.filename,
        original_name: safeName(f.originalname),
        mimetype: f.mimetype,
        size: f.size
      }))
      res.status(201).json(files)
    } catch (e) {
      console.error('[UPLOAD ERROR]', e)
      res.status(500).json({ error: '保存上传记录失败' })
    }
  })
})

app.put('/api/pages/:id', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  if (!getPage(id)) return res.status(404).json({ error: '病历页不存在' })
  res.json(updatePage(id, {
    title: safeName(req.body?.title),
    note: safeName(req.body?.note),
    department: req.body?.department !== undefined ? (safeName(req.body.department) || '未分类') : undefined,
    visit_date: req.body?.visit_date !== undefined ? safeDate(req.body.visit_date) : undefined
  }))
}))

app.delete('/api/pages/:id', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  const page = getPage(id)
  if (!page) return res.status(404).json({ error: '病历页不存在' })
  deletePage(id)
  const file = path.join(UPLOAD_DIR, String(page.binder_id), path.basename(page.filename))
  fs.rmSync(file, { force: true })
  res.json({ ok: true })
}))

app.post('/api/binders/:id/pages/reorder', requireAuth, asyncRoute((req, res) => {
  const binderId = Number(req.params.id)
  if (!getBinder(binderId)) return res.status(404).json({ error: '资料册不存在' })
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : []
  reorderPages(binderId, ids)
  res.json({ ok: true })
}))

// ---------- 文件服务（鉴权后流式返回，防目录穿越）----------
app.get('/api/files/:id', requireAuth, asyncRoute((req, res) => {
  const id = Number(req.params.id)
  const page = getPage(id)
  if (!page) return res.status(404).send('文件不存在')
  const file = path.join(UPLOAD_DIR, String(page.binder_id), path.basename(page.filename))
  if (!fs.existsSync(file)) return res.status(404).send('文件已丢失')
  res.setHeader('Content-Type', page.mimetype || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(page.original_name)}`)
  fs.createReadStream(file).pipe(res)
}))

// ---------- 静态前端 ----------
app.use(express.static(DIST_DIR, { index: 'index.html' }))
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' })
  const index = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(index)) return res.sendFile(index)
  res.status(200).send('<h2>Care Binder</h2><p>前端尚未构建。请在项目根目录运行 npm run build。</p>')
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Care Binder] 服务已启动 http://0.0.0.0:${PORT}`)
  console.log(`[Care Binder] 数据目录: ${DATA_DIR}`)
})
