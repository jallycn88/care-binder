import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let db = null

export function initDb(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'care-binder.db')
  db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS binders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#7c9cbf',
      age INTEGER,
      height REAL,
      weight REAL,
      avatar TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      binder_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      department TEXT NOT NULL DEFAULT '未分类',
      visit_date TEXT NOT NULL DEFAULT '',
      page_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (binder_id) REFERENCES binders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pages_binder ON pages(binder_id);
  `)
  // 迁移：旧库补列（幂等，重复启动安全）
  const pageCols = db.prepare('PRAGMA table_info(pages)').all().map(c => c.name)
  if (!pageCols.includes('department')) db.exec("ALTER TABLE pages ADD COLUMN department TEXT NOT NULL DEFAULT '未分类'")
  if (!pageCols.includes('visit_date')) db.exec("ALTER TABLE pages ADD COLUMN visit_date TEXT NOT NULL DEFAULT ''")
  // binders 基本信息字段（年龄/身高/体重/头像）
  const binderCols = db.prepare('PRAGMA table_info(binders)').all().map(c => c.name)
  if (!binderCols.includes('age')) db.exec('ALTER TABLE binders ADD COLUMN age INTEGER')
  if (!binderCols.includes('height')) db.exec('ALTER TABLE binders ADD COLUMN height REAL')
  if (!binderCols.includes('weight')) db.exec('ALTER TABLE binders ADD COLUMN weight REAL')
  if (!binderCols.includes('avatar')) db.exec("ALTER TABLE binders ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

export function getDb() {
  if (!db) throw new Error('数据库未初始化')
  return db
}

const now = () => new Date().toISOString()

export function listBinders() {
  return getDb().prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM pages p WHERE p.binder_id = b.id) AS page_count
    FROM binders b ORDER BY b.id ASC
  `).all()
}

export function createBinder({ name, relation, color, age, height, weight }) {
  const t = now()
  const r = getDb().prepare(
    'INSERT INTO binders (name, relation, color, age, height, weight, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, relation || '', color || '#7c9cbf', age ?? null, height ?? null, weight ?? null, t, t)
  return getBinder(Number(r.lastInsertRowid))
}

export function getBinder(id) {
  return getDb().prepare('SELECT * FROM binders WHERE id = ?').get(id) || null
}

export function updateBinder(id, { name, relation, color, age, height, weight }) {
  getDb().prepare(
    'UPDATE binders SET name=?, relation=?, color=?, age=?, height=?, weight=?, updated_at=? WHERE id=?'
  ).run(name, relation || '', color || '#7c9cbf', age ?? null, height ?? null, weight ?? null, now(), id)
  return getBinder(id)
}

// 仅更新头像文件名
export function updateBinderAvatar(id, avatar) {
  getDb().prepare('UPDATE binders SET avatar=?, updated_at=? WHERE id=?').run(avatar || '', now(), id)
  return getBinder(id)
}

export function deleteBinder(id) {
  return getDb().prepare('DELETE FROM binders WHERE id = ?').run(id).changes > 0
}

export function listPages(binderId) {
  return getDb().prepare(
    'SELECT * FROM pages WHERE binder_id = ? ORDER BY page_order ASC, id ASC'
  ).all(binderId)
}

export function createPage(data) {
  const t = now()
  const maxOrder = getDb().prepare(
    'SELECT COALESCE(MAX(page_order), -1) AS m FROM pages WHERE binder_id = ?'
  ).get(data.binder_id).m
  const r = getDb().prepare(`
    INSERT INTO pages (binder_id, title, note, filename, original_name, mimetype, size, department, visit_date, page_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.binder_id, data.title, data.note || '', data.filename,
    data.original_name, data.mimetype, data.size, data.department || '未分类', data.visit_date || '',
    maxOrder + 1, t
  )
  return getPage(Number(r.lastInsertRowid))
}

export function getPage(id) {
  return getDb().prepare('SELECT * FROM pages WHERE id = ?').get(id) || null
}

export function updatePage(id, { title, note, department, visit_date }) {
  const p = getPage(id)
  getDb().prepare('UPDATE pages SET title=?, note=?, department=?, visit_date=? WHERE id=?').run(
    title, note || '', department ?? p.department ?? '未分类', visit_date ?? p.visit_date ?? '', id
  )
  return getPage(id)
}

export function deletePage(id) {
  return getDb().prepare('DELETE FROM pages WHERE id = ?').run(id).changes > 0
}

export function reorderPages(binderId, ids) {
  const stmt = getDb().prepare('UPDATE pages SET page_order=? WHERE id=? AND binder_id=?')
  const tx = getDb().prepare('BEGIN')
  try {
    tx.run()
    ids.forEach((pid, i) => stmt.run(i, pid, binderId))
    getDb().prepare('COMMIT').run()
  } catch (e) {
    getDb().prepare('ROLLBACK').run()
    throw e
  }
}
