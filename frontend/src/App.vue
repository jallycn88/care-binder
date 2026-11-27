<script setup>
import { ref, computed, onMounted } from 'vue'
import PdfViewer from './components/PdfViewer.vue'

const view = ref('loading') // loading | login | shelf | binder
const binders = ref([])
const currentBinder = ref(null)
const pages = ref([])
const usernameInput = ref('admin')
const passwordInput = ref('')
const loginError = ref('')
const toast = ref('')
const showAddModal = ref(false)
const showEditModal = ref(false)
const newBinder = ref({ name: '', relation: '', color: '#7c9cbf', age: '', height: '', weight: '' })
const editBinder = ref({ id: null, name: '', relation: '', color: '#7c9cbf', age: '', height: '', weight: '' })
const uploading = ref(false)
const fileInput = ref(null)
const selectedFiles = ref([])
const uploadDepartment = ref('未分类')
const uploadVisitDate = ref('')

// 科室预设（可自定义输入）
const DEPARTMENTS = ['未分类', '内科', '外科', '儿科', '妇产科', '皮肤科', '眼科', '耳鼻喉科', '口腔科', '骨科', '检验科', '体检科', '其他']

function onFileChange(e) {
  selectedFiles.value = Array.from(e.target.files || []).map(f => f.name)
}

// 医生互动：点击换一句台词并弹一下气泡
const doctorLines = [
  '欢迎回来！点击资料册查看家人的健康档案。',
  '按时体检，健康档案要及时更新哦～',
  '有什么不舒服，记得早点来看医生。',
  '我会一直守着全家人的健康档案。',
  '别熬夜啦，身体是革命的本钱！'
]
const doctorLineIndex = ref(0)
const bubblePop = ref(false)
const doctorLine = computed(() => doctorLines[doctorLineIndex.value])

function pokeDoctor() {
  doctorLineIndex.value = (doctorLineIndex.value + 1) % doctorLines.length
  bubblePop.value = false
  requestAnimationFrame(() => { bubblePop.value = true })
  setTimeout(() => { bubblePop.value = false }, 400)
}

// 翻页状态
const currentPage = ref(0)
const turning = ref(false)
const turnDirection = ref(1)
const touchStartX = ref(0)

// 浏览模式：info（基本信息）| timeline（时间轴）
const browseMode = ref('info')
const avatarInput = ref(null)
const editAvatarInput = ref(null)

// BMI（身高 cm / 体重 kg）
const bmi = computed(() => {
  const h = Number(currentBinder.value?.height), w = Number(currentBinder.value?.weight)
  if (!h || !w || h < 50 || h > 260) return null
  const m = h / 100
  const v = w / (m * m)
  return Number.isFinite(v) ? v.toFixed(1) : null
})
const bmiLabel = computed(() => {
  const v = Number(bmi.value)
  if (!v) return ''
  if (v < 18.5) return '偏瘦'
  if (v < 24) return '正常'
  if (v < 28) return '偏胖'
  return '肥胖'
})
const bmiTone = computed(() => {
  const l = bmiLabel.value
  if (l === '正常') return 'ok'
  if (l === '偏瘦' || l === '偏胖') return 'warn'
  return 'bad'
})
const activeDepartment = ref('全部')
const lightboxPage = ref(null) // 当前放大查看的病历页
const lightboxGroup = ref([])  // 同一组（同一次检查）的页，用于组内翻看
const lightboxIndex = ref(0)   // 当前页在组内的下标

function openLightbox(page, group) {
  lightboxPage.value = page
  lightboxGroup.value = group || [page]
  lightboxIndex.value = Math.max(0, lightboxGroup.value.findIndex(p => p.id === page.id))
}
function lightboxNav(dir) {
  const g = lightboxGroup.value
  if (g.length < 2) return
  lightboxIndex.value = (lightboxIndex.value + dir + g.length) % g.length
  lightboxPage.value = g[lightboxIndex.value]
}
function closeLightbox() {
  lightboxPage.value = null
  lightboxGroup.value = []
  lightboxIndex.value = 0
}

const colors = ['#7c9cbf', '#e2a0a8', '#9dc4a0', '#d4b27a', '#b39ac4', '#8fb8c4']
const hasPages = computed(() => pages.value.length > 0)

// 本科室下出现的科室列表（用于筛选栏）
const departmentList = computed(() => {
  const set = new Set(pages.value.map(p => p.department || '未分类'))
  return ['全部', ...DEPARTMENTS.filter(d => set.has(d)), ...[...set].filter(d => !DEPARTMENTS.includes(d) && d !== '全部')]
})
// 筛选后的页（按当前科室）
const filteredPages = computed(() => activeDepartment.value === '全部'
  ? pages.value
  : pages.value.filter(p => (p.department || '未分类') === activeDepartment.value))
// 时间轴：有就诊日期的按日期倒序，无日期的按创建时间补后
const timelinePages = computed(() => [...filteredPages.value].sort((a, b) => {
  const da = a.visit_date || a.created_at.slice(0, 10)
  const db = b.visit_date || b.created_at.slice(0, 10)
  return db.localeCompare(da) || b.id - a.id
}))
// 时间轴聚合：同一天 + 同科室的病历合并为一条，照片平铺在一起看
const timelineGroups = computed(() => {
  const entries = []
  for (const p of timelinePages.value) {
    const date = p.visit_date || p.created_at.slice(0, 10)
    const dept = p.department || '未分类'
    const key = `${date}|${dept}`
    let e = entries.find(x => x.key === key)
    if (!e) {
      e = { key, date, department: dept, pages: [], title: p.title }
      entries.push(e)
    }
    e.pages.push(p)
  }
  const groups = []
  for (const e of entries) {
    const ym = e.date.slice(0, 7).replace('-', ' 年 ') + ' 月'
    let g = groups.find(x => x.label === ym)
    if (!g) { g = { label: ym, items: [] }; groups.push(g) }
    g.items.push(e)
  }
  return groups
})
const currentPageData = computed(() => filteredPages.value[currentPage.value] || null)

// 时间轴展示用日期（优先就诊日期）
function displayDate(p) { return p.visit_date || p.created_at.slice(0, 10) }

function showToast(msg) {
  toast.value = msg
  setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2600)
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  if (res.status === 401 && view.value !== 'login') {
    view.value = 'login'
    throw new Error('登录已过期')
  }
  if (!res.ok) {
    let msg = '请求失败'
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

async function init() {
  try {
    const status = await api('/api/auth/status')
    if (!status.authenticated) { view.value = 'login'; return }
    await loadBinders()
    view.value = 'shelf'
  } catch { view.value = 'login' }
}

async function login() {
  loginError.value = ''
  if (!usernameInput.value.trim()) { loginError.value = '请输入账号'; return }
  if (!passwordInput.value) { loginError.value = '请输入密码'; return }
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value }) })
    passwordInput.value = ''
    await loadBinders()
    view.value = 'shelf'
  } catch (e) { loginError.value = e.message }
}

async function logout() {
  await api('/api/logout', { method: 'POST' })
  binders.value = []
  view.value = 'login'
}

async function loadBinders() {
  binders.value = await api('/api/binders')
}

// 过场动画状态：idle → pull（抽出）→ open（翻开）→ 进入资料页
const transitionBinder = ref(null)
const transitionStage = ref('idle') // idle | pull | open

async function openBinder(b, e) {
  if (transitionStage.value !== 'idle') return
  // 记录被点卡片的屏幕位置，让书从原位抽出
  if (e?.currentTarget) {
    const r = e.currentTarget.getBoundingClientRect()
    const root = document.documentElement
    root.style.setProperty('--fly-from-x', `${r.left + r.width / 2 - window.innerWidth / 2}px`)
    root.style.setProperty('--fly-from-y', `${r.top + r.height / 2 - window.innerHeight / 2}px`)
  }
  transitionBinder.value = b
  transitionStage.value = 'pull'
  currentBinder.value = b
  currentPage.value = 0
  pages.value = []
  activeDepartment.value = '全部'
  browseMode.value = 'info'
  closeLightbox()
  // 提前并行加载数据，动画结束后立即可见
  const loading = loadPages(b.id)
  setTimeout(() => { transitionStage.value = 'open' }, 620)
  setTimeout(async () => {
    await loading
    view.value = 'binder'
    transitionStage.value = 'idle'
    transitionBinder.value = null
  }, 1420)
}

async function loadPages(binderId) {
  pages.value = await api(`/api/binders/${binderId}/pages`)
  if (currentPage.value >= filteredPages.value.length) currentPage.value = Math.max(0, filteredPages.value.length - 1)
}

function pickDepartment(d) {
  activeDepartment.value = d
  currentPage.value = 0
}

async function addBinder() {
  if (!newBinder.value.name.trim()) return showToast('请填写家人姓名')
  try {
    await api('/api/binders', { method: 'POST', body: JSON.stringify(newBinder.value) })
    showAddModal.value = false
    newBinder.value = { name: '', relation: '', color: colors[binders.value.length % colors.length], age: '', height: '', weight: '' }
    await loadBinders()
    showToast('资料册已创建')
  } catch (e) { showToast(e.message) }
}

function openEdit(b) {
  editBinder.value = {
    id: b.id, name: b.name, relation: b.relation, color: b.color,
    age: b.age ?? '', height: b.height ?? '', weight: b.weight ?? '',
    avatar_url: b.avatar_url || ''
  }
  showEditModal.value = true
}

// 通用头像上传：成功后同步刷新 当前册/编辑弹窗/书柜列表 三处数据
async function uploadAvatarFor(binderId, file, inputRef) {
  if (!binderId) return showToast('请先选择家人')
  const fd = new FormData()
  fd.append('avatar', file)
  try {
    const updated = await api(`/api/binders/${binderId}/avatar`, { method: 'POST', body: fd, headers: {} })
    if (currentBinder.value?.id === updated.id) currentBinder.value = updated
    if (editBinder.value?.id === updated.id) editBinder.value = { ...editBinder.value, avatar_url: updated.avatar_url }
    const idx = binders.value.findIndex(b => b.id === updated.id)
    if (idx >= 0) binders.value[idx] = updated
    showToast('头像已更新')
  } catch (err) { showToast(err.message) }
  finally { if (inputRef?.value) inputRef.value.value = '' }
}

// 基本信息页的头像上传
function onAvatarChange(e) {
  const f = e.target.files?.[0]
  if (f) uploadAvatarFor(currentBinder.value?.id, f, avatarInput)
}

// 编辑资料册弹窗里的头像上传
function onEditAvatarChange(e) {
  const f = e.target.files?.[0]
  if (f) uploadAvatarFor(editBinder.value?.id, f, editAvatarInput)
}

async function saveEdit() {
  if (!editBinder.value.name.trim()) return showToast('请填写家人姓名')
  try {
    await api(`/api/binders/${editBinder.value.id}`, { method: 'PUT', body: JSON.stringify(editBinder.value) })
    showEditModal.value = false
    await loadBinders()
    showToast('已保存')
  } catch (e) { showToast(e.message) }
}

async function removeBinder(b) {
  if (!confirm(`确定删除「${b.name}」的资料册及其所有病历文件吗？此操作不可恢复。`)) return
  try {
    await api(`/api/binders/${b.id}`, { method: 'DELETE' })
    await loadBinders()
    showToast('资料册已删除')
  } catch (e) { showToast(e.message) }
}

async function onUpload() {
  const files = fileInput.value?.files
  if (!files || !files.length) return showToast('请先选择文件')
  uploading.value = true
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  fd.append('department', uploadDepartment.value)
  if (uploadVisitDate.value) fd.append('visit_date', uploadVisitDate.value)
  try {
    await api(`/api/binders/${currentBinder.value.id}/pages`, { method: 'POST', body: fd, headers: {} })
    if (fileInput.value) fileInput.value.value = ''
    selectedFiles.value = []
    uploadVisitDate.value = ''
    await loadPages(currentBinder.value.id)
    showToast('上传成功')
  } catch (e) { showToast(e.message) }
  finally { uploading.value = false }
}

async function removePage(page) {
  if (!confirm(`确定删除「${page.title}」吗？`)) return
  try {
    await api(`/api/pages/${page.id}`, { method: 'DELETE' })
    await loadPages(currentBinder.value.id)
    showToast('已删除')
  } catch (e) { showToast(e.message) }
}

function flip(dir) {
  if (turning.value || browseMode.value !== 'book') return
  const next = currentPage.value + dir
  if (next < 0 || next >= filteredPages.value.length) return
  turnDirection.value = dir
  turning.value = true
  setTimeout(() => {
    currentPage.value = next
    turning.value = false
  }, 340)
}

function onKey(e) {
  if (lightboxPage.value) {
    if (e.key === 'Escape') closeLightbox()
    else if (e.key === 'ArrowRight') lightboxNav(1)
    else if (e.key === 'ArrowLeft') lightboxNav(-1)
    return
  }
  if (view.value !== 'binder') return
  if (e.key === 'ArrowRight') flip(1)
  if (e.key === 'ArrowLeft') flip(-1)
  if (e.key === 'Escape') view.value = 'shelf'
}

function onTouchStart(e) { touchStartX.value = e.touches[0].clientX }
function onTouchEnd(e) {
  const dx = e.changedTouches[0].clientX - touchStartX.value
  if (Math.abs(dx) > 60) flip(dx < 0 ? 1 : -1)
}

function formatSize(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

function fileUrl(id) { return `/api/files/${id}` }
function isImage(page) { return /^image\//.test(page.mimetype) }
function isPdf(page) { return page.mimetype === 'application/pdf' || /\.pdf$/i.test(page.original_name || '') }

// 编辑病历（标题/科室/就诊日期/备注）
async function editPage(page) {
  const title = prompt('标题：', page.title)
  if (title === null) return
  const dept = prompt('科室（如：内科、体检科）：', page.department || '未分类')
  if (dept === null) return
  const date = prompt('就诊日期（YYYY-MM-DD，可留空）：', page.visit_date || '')
  if (date === null) return
  const note = prompt('备注：', page.note || '')
  if (note === null) return
  try {
    await api(`/api/pages/${page.id}`, { method: 'PUT', body: JSON.stringify({ title, department: dept, visit_date: date, note }) })
    await loadPages(currentBinder.value.id)
    if (lightboxPage.value?.id === page.id) closeLightbox()
    showToast('已保存')
  } catch (e) { showToast(e.message) }
}

onMounted(() => {
  init()
  window.addEventListener('keydown', onKey)
})
</script>

<template>
  <div class="app-shell">
    <!-- 加载 -->
    <div v-if="view === 'loading'" class="login-wrap"><div class="login-card"><p class="sub">正在加载…</p></div></div>

    <!-- 登录 -->
    <div v-else-if="view === 'login'" class="login-wrap">
      <div class="login-card">
        <div class="login-logo"><span class="login-logo-cross">+</span></div>
        <h1>家人健康书柜</h1>
        <p class="sub">登录后查看全家人的健康档案</p>
        <form @submit.prevent="login">
          <label class="login-label">账号</label>
          <div class="login-field">
            <span class="login-field-icon">👤</span>
            <input type="text" v-model="usernameInput" placeholder="请输入账号" autocomplete="username" autofocus />
          </div>
          <label class="login-label">密码</label>
          <div class="login-field">
            <span class="login-field-icon">🔒</span>
            <input type="password" v-model="passwordInput" placeholder="请输入密码" autocomplete="current-password" />
          </div>
          <div class="login-error">{{ loginError }}</div>
          <button type="submit" class="btn btn-primary">登 录</button>
        </form>
        <div class="login-foot">家人病历管理 · 私密健康档案</div>
      </div>
    </div>

    <!-- 书柜主界面 -->
    <div v-else-if="view === 'shelf'" class="scene">
      <div class="topbar">
        <div class="brand"><span class="brand-mark">+</span> 家人健康书柜</div>
        <div class="top-actions">
          <button class="btn btn-primary btn-sm" @click="showAddModal = true; newBinder.color = colors[binders.length % colors.length]">+ 新建资料册</button>
          <button class="btn btn-ghost btn-sm" @click="logout">退出</button>
        </div>
      </div>
      <div class="shelf-area">
        <div class="doctor-slot">
          <div class="doctor-figure" @click="pokeDoctor" title="点我一下">
            <img src="/assets/doctor.webp" alt="家庭医生" />
            <div class="eyelid eyelid-left"></div>
            <div class="eyelid eyelid-right"></div>
          </div>
          <div class="doctor-bubble" :class="{ 'bubble-pop': bubblePop }">{{ doctorLine }}</div>
        </div>
        <div class="shelf-board">
          <div v-for="b in binders" :key="b.id" class="binder-card" :style="{ background: `linear-gradient(160deg, ${b.color}, ${b.color}cc)` }" @click="openBinder(b, $event)">
            <div class="binder-spine"><i></i><i></i></div>
            <div class="binder-face">
              <img v-if="b.avatar_url" class="binder-avatar" :src="b.avatar_url" :alt="b.name" />
              <div v-else class="binder-cross">+</div>
              <div class="binder-name">{{ b.name }}</div>
              <div class="binder-relation">{{ b.relation || '家人' }}</div>
            </div>
            <div class="binder-count">{{ b.page_count }} 份</div>
            <button class="btn btn-ghost btn-sm" style="position:absolute;top:4px;right:4px;padding:2px 7px;font-size:11px;z-index:3" @click.stop="openEdit(b)">✎</button>
            <button class="btn btn-ghost btn-sm" style="position:absolute;top:4px;left:18px;padding:2px 7px;font-size:11px;z-index:3" @click.stop="removeBinder(b)">×</button>
          </div>
          <div class="binder-card binder-add" @click="showAddModal = true">
            <div class="plus">+</div>
            <div>新建资料册</div>
          </div>
          <div v-if="!binders.length" class="empty-hint">书柜还是空的，点击「新建资料册」为家人建立第一本健康档案。</div>
        </div>
      </div>

      <!-- 抽书 → 翻开 过场动画 -->
      <div v-if="transitionBinder" class="flip-transition" :class="'stage-' + transitionStage">
        <div class="flip-backdrop"></div>
        <div class="flip-book">
          <div class="flip-book-body">
            <div class="flip-book-page" :style="{ background: transitionBinder.color + '22' }">
              <div class="flip-page-lines"></div>
              <div class="flip-page-lines"></div>
              <div class="flip-page-lines"></div>
            </div>
            <div class="flip-book-page left" :style="{ background: transitionBinder.color + '18' }">
              <div class="flip-page-lines"></div>
              <div class="flip-page-lines"></div>
            </div>
          </div>
          <div class="flip-book-cover" :style="{ background: `linear-gradient(160deg, ${transitionBinder.color}, ${transitionBinder.color}cc)` }">
            <div class="binder-cross">+</div>
            <div class="flip-cover-name">{{ transitionBinder.name }}</div>
            <div class="flip-cover-relation">{{ transitionBinder.relation || '家人' }}</div>
          </div>
        </div>
        <div class="flip-hint">{{ transitionStage === 'pull' ? '取出档案…' : '打开档案…' }}</div>
      </div>
    </div>

    <!-- 资料页 -->
    <div v-else-if="view === 'binder'" class="binder-view">
      <div class="binder-header">
        <button class="btn btn-ghost btn-sm" @click="view = 'shelf'">← 返回书柜</button>
        <h2>{{ currentBinder?.name }} 的健康档案</h2>
        <span class="meta">{{ pages.length }} 份病历资料</span>
        <div class="spacer"></div>
        <div class="mode-switch">
          <button :class="{ active: browseMode === 'info' }" @click="browseMode = 'info'">👤 基本情况</button>
          <button :class="{ active: browseMode === 'timeline' }" @click="browseMode = 'timeline'">🕐 病历时间轴</button>
        </div>
      </div>

      <div class="book-area">
        <!-- ===== 基本信息视图（替换原翻书页） ===== -->
        <div v-if="browseMode === 'info'" class="profile-view">
          <div class="profile-card" :style="{ '--profile-color': currentBinder?.color || '#7c9cbf' }">
            <div class="profile-avatar-wrap" @click="avatarInput?.click()" title="点击更换头像">
              <img v-if="currentBinder?.avatar_url" :src="currentBinder.avatar_url" alt="头像" />
              <div v-else class="profile-avatar-ph">{{ (currentBinder?.name || '?').slice(0, 1) }}</div>
              <span class="profile-avatar-cam" aria-label="更换头像">换</span>
            </div>
            <input type="file" ref="avatarInput" accept="image/*" style="display:none" @change="onAvatarChange" />
            <div class="profile-info">
              <div class="profile-heading">
                <h3>{{ currentBinder?.name }}</h3>
                <span class="profile-relation">{{ currentBinder?.relation || '家人' }}</span>
              </div>
              <div class="profile-stats">
                <div class="profile-stat">
                  <span class="ps-label">年龄</span>
                  <span class="ps-value">{{ currentBinder?.age != null ? currentBinder.age : '—' }}<small v-if="currentBinder?.age != null">岁</small></span>
                </div>
                <div class="profile-stat">
                  <span class="ps-label">身高</span>
                  <span class="ps-value">{{ currentBinder?.height != null ? currentBinder.height : '—' }}<small v-if="currentBinder?.height != null">cm</small></span>
                </div>
                <div class="profile-stat">
                  <span class="ps-label">体重</span>
                  <span class="ps-value">{{ currentBinder?.weight != null ? currentBinder.weight : '—' }}<small v-if="currentBinder?.weight != null">kg</small></span>
                </div>
                <div class="profile-stat" v-if="bmi">
                  <span class="ps-label">BMI</span>
                  <span class="ps-value">{{ bmi }}</span>
                  <span class="bmi-tag" :class="'bmi-' + bmiTone">{{ bmiLabel }}</span>
                </div>
              </div>
              <div class="profile-actions">
                <button class="btn btn-pick btn-sm" @click="openEdit(currentBinder)">✎ 编辑基本情况</button>
                <button class="btn btn-pick btn-sm" @click="avatarInput?.click()">更换头像</button>
              </div>
            </div>
          </div>
          <div class="profile-tip">点右侧「病历时间轴」查看与上传家人的病历资料 · 点头像可直接更换照片</div>
        </div>

        <!-- ===== 病历时间轴视图 ===== -->
        <div v-else class="timeline-view">
        <div class="upload-zone">
          <select v-model="uploadDepartment" title="科室分类">
            <option v-for="d in DEPARTMENTS" :key="d" :value="d">{{ d }}</option>
          </select>
          <input type="date" v-model="uploadVisitDate" title="就诊日期（可选）" />
          <input type="file" ref="fileInput" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.pdf,.doc,.docx,.xls,.xlsx,.txt" @change="onFileChange" />
          <button class="btn btn-pick btn-sm" @click="fileInput?.click()">选择文件</button>
          <button class="btn btn-primary btn-sm" :disabled="uploading" @click="onUpload">{{ uploading ? '上传中…' : '上传' }}</button>
        </div>
        <div class="upload-hint">支持图片 / PDF / Word / Excel / TXT，单个 ≤80MB · 图片与 PDF 可直接查看</div>
        <div v-if="selectedFiles.length" class="selected-files">
          已选 {{ selectedFiles.length }} 个文件：
          <span v-for="(name, i) in selectedFiles" :key="i" class="file-tag">{{ name }}</span>
        </div>

        <!-- 科室筛选栏 -->
        <div v-if="hasPages" class="dept-filter">
          <span class="dept-filter-label">科室：</span>
          <button v-for="d in departmentList" :key="d" :class="{ active: activeDepartment === d }" @click="pickDepartment(d)">{{ d }}</button>
        </div>

        <div v-if="!hasPages" class="loading">还没有病历资料，在上方上传后即可在时间轴查看。</div>

        <!-- 时间轴 -->
        <div v-if="hasPages" class="timeline">
          <!-- 单科查询：按科室筛选时间轴记录 -->
          <div class="tl-query">
            <span class="tl-query-label">🔍 按科室查询</span>
            <select v-model="activeDepartment" @change="currentPage = 0" class="tl-query-select">
              <option v-for="d in departmentList" :key="d" :value="d">{{ d }}</option>
            </select>
            <span class="tl-query-count">共 {{ filteredPages.length }} 条记录</span>
            <button v-if="activeDepartment !== '全部'" class="btn btn-pick btn-sm" @click="pickDepartment('全部')">显示全部</button>
          </div>
          <div v-if="!filteredPages.length" class="loading">该科室下暂无记录，可在上方切换其他科室。</div>
          <div v-for="group in timelineGroups" :key="group.label" class="tl-group">
            <div class="tl-month">{{ group.label }}</div>
            <div v-for="e in group.items" :key="e.key" class="tl-item">
              <div class="tl-dot"></div>
              <div class="tl-date">{{ e.date.slice(5) }}</div>
              <div class="tl-card">
                <div class="tl-card-head">
                  <span class="dept-badge">{{ e.department }}</span>
                  <strong>{{ e.title }}</strong>
                  <span v-if="e.pages.length > 1" class="tl-count-badge">{{ e.pages.length }} 份一起看</span>
                </div>
                <!-- 同一次检查的多张照片平铺 -->
                <div class="tl-photo-grid">
                  <div v-for="p in e.pages" :key="p.id" class="tl-photo">
                    <img v-if="isImage(p)" :src="fileUrl(p.id)" :alt="p.title" @click="openLightbox(p, e.pages)" title="点击查看，可左右翻看" />
                    <div v-else-if="isPdf(p)" class="tl-pdf" @click="openLightbox(p, e.pages)">📕 PDF</div>
                    <div v-else class="tl-file">📄 {{ p.original_name }}</div>
                    <div class="tl-photo-bar">
                      <span class="tl-photo-title" :title="p.title">{{ p.title }}</span>
                      <button class="tl-mini" @click="editPage(p)" title="编辑">✎</button>
                      <button class="tl-mini tl-mini-del" @click="removePage(p)" title="删除">✕</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>

    <!-- 大图查看器 -->
    <div v-if="lightboxPage" class="lightbox" @click.self="closeLightbox">
      <div class="lightbox-bar">
        <span>{{ lightboxPage.title }} · {{ lightboxPage.department || '未分类' }} · {{ displayDate(lightboxPage) }}</span>
        <div class="lightbox-tools">
          <template v-if="lightboxGroup.length > 1">
            <button class="btn btn-pick btn-sm" @click="lightboxNav(-1)">‹ 上一张</button>
            <span class="lightbox-counter">{{ lightboxIndex + 1 }} / {{ lightboxGroup.length }}</span>
            <button class="btn btn-pick btn-sm" @click="lightboxNav(1)">下一张 ›</button>
          </template>
          <button class="btn btn-pick btn-sm" @click="closeLightbox">关闭 ✕</button>
        </div>
      </div>
      <div class="lightbox-stage">
        <img v-if="isImage(lightboxPage)" :src="fileUrl(lightboxPage.id)" :alt="lightboxPage.title" />
        <div v-else-if="isPdf(lightboxPage)" class="lightbox-pdf-wrap"><PdfViewer :url="fileUrl(lightboxPage.id)" fit="contain" /></div>
      </div>
    </div>

    <!-- 新增资料册弹窗 -->
    <div v-if="showAddModal" class="modal-mask" @click.self="showAddModal = false">
      <div class="modal">
        <h3>新建资料册</h3>
        <label>家人姓名</label>
        <input type="text" v-model="newBinder.name" placeholder="如：父亲、母亲、小明" />
        <label>关系称呼（可选）</label>
        <input type="text" v-model="newBinder.relation" placeholder="如：爸爸、妈妈、儿子" />
        <div class="modal-row3">
          <div><label>年龄（可选）</label><input type="number" v-model="newBinder.age" min="0" max="130" placeholder="岁" /></div>
          <div><label>身高（可选）</label><input type="number" v-model="newBinder.height" min="20" max="260" step="0.1" placeholder="cm" /></div>
          <div><label>体重（可选）</label><input type="number" v-model="newBinder.weight" min="1" max="500" step="0.1" placeholder="kg" /></div>
        </div>
        <label>封面颜色</label>
        <input type="color" v-model="newBinder.color" />
        <div class="modal-btns">
          <button class="btn btn-ghost" @click="showAddModal = false">取消</button>
          <button class="btn btn-primary" @click="addBinder">创建</button>
        </div>
      </div>
    </div>

    <!-- 编辑资料册弹窗 -->
    <div v-if="showEditModal" class="modal-mask" @click.self="showEditModal = false">
      <div class="modal">
        <h3>编辑资料册</h3>
        <div class="modal-avatar" @click="editAvatarInput?.click()" title="点击上传/更换头像">
          <img v-if="editBinder.avatar_url" :src="editBinder.avatar_url" alt="头像" />
          <div v-else class="modal-avatar-ph">{{ (editBinder.name || '?').slice(0, 1) }}</div>
          <span class="modal-avatar-cam">换</span>
        </div>
        <div class="modal-avatar-hint">点击头像上传照片，会显示在书柜的资料册上</div>
        <input type="file" ref="editAvatarInput" accept="image/*" style="display:none" @change="onEditAvatarChange" />
        <label>家人姓名</label>
        <input type="text" v-model="editBinder.name" />
        <label>关系称呼</label>
        <input type="text" v-model="editBinder.relation" />
        <div class="modal-row3">
          <div><label>年龄</label><input type="number" v-model="editBinder.age" min="0" max="130" placeholder="岁" /></div>
          <div><label>身高</label><input type="number" v-model="editBinder.height" min="20" max="260" step="0.1" placeholder="cm" /></div>
          <div><label>体重</label><input type="number" v-model="editBinder.weight" min="1" max="500" step="0.1" placeholder="kg" /></div>
        </div>
        <label>封面颜色</label>
        <input type="color" v-model="editBinder.color" />
        <div class="modal-btns">
          <button class="btn btn-ghost" @click="showEditModal = false">取消</button>
          <button class="btn btn-primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
