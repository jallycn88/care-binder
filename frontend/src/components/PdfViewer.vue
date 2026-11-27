<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const props = defineProps({
  url: { type: String, required: true },
  fit: { type: String, default: 'contain' } // contain | width
})

const canvas = ref(null)
const numPages = ref(0)
const pageNum = ref(1)
const loading = ref(true)
const error = ref('')
let pdfDoc = null
let renderTask = null
let gen = 0 // 代次标记，防止旧URL的异步渲染覆盖新URL

async function load() {
  const myGen = ++gen
  loading.value = true
  error.value = ''
  numPages.value = 0
  pageNum.value = 1
  if (renderTask) { renderTask.cancel(); renderTask = null }
  if (pdfDoc) { try { pdfDoc.destroy() } catch {} pdfDoc = null }
  try {
    const res = await fetch(props.url, { credentials: 'same-origin' })
    if (!res.ok) throw new Error('PDF 加载失败: ' + res.status)
    const buf = await res.arrayBuffer()
    if (myGen !== gen) return // 已切换到别的URL
    pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise
    if (myGen !== gen) return
    numPages.value = pdfDoc.numPages
    loading.value = false
    // DOM 更新后再渲染（canvas 常驻，此处只等布局生效）
    requestAnimationFrame(() => { if (myGen === gen) render(1) })
  } catch (e) {
    if (myGen !== gen) return
    error.value = e.message || 'PDF 渲染失败'
    loading.value = false
  }
}

async function render(n) {
  if (!pdfDoc) return
  if (renderTask) { renderTask.cancel(); renderTask = null }
  try {
    const page = await pdfDoc.getPage(n)
    const el = canvas.value
    if (!el) return
    const container = el.parentElement
    const availW = Math.max((container?.clientWidth || 0) - 8, 200)
    const availH = (container?.clientHeight || 0) - 8
    let viewport = page.getViewport({ scale: 1 })
    let scale = props.fit === 'width' ? availW / viewport.width : 1
    if (props.fit === 'contain' && availH > 40) {
      scale = Math.min(availW / viewport.width, availH / viewport.height)
    } else if (props.fit === 'contain') {
      scale = Math.min(scale, availW / viewport.width)
    }
    viewport = page.getViewport({ scale })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    el.width = Math.floor(viewport.width * dpr)
    el.height = Math.floor(viewport.height * dpr)
    el.style.width = Math.floor(viewport.width) + 'px'
    el.style.height = Math.floor(viewport.height) + 'px'
    const ctx = el.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderTask = page.render({ canvasContext: ctx, viewport })
    await renderTask.promise
    renderTask = null
    pageNum.value = n
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') error.value = e.message || '渲染失败'
  }
}

function go(delta) {
  const n = pageNum.value + delta
  if (n < 1 || n > numPages.value) return
  render(n)
}

watch(() => props.url, load)
onBeforeUnmount(() => {
  gen++
  if (renderTask) renderTask.cancel()
  if (pdfDoc) { try { pdfDoc.destroy() } catch {} }
})

load()
</script>

<template>
  <div class="pdf-viewer">
    <canvas ref="canvas" class="pdf-canvas" :class="{ hidden: loading || !!error }"></canvas>
    <div v-if="loading" class="pdf-msg">正在加载 PDF…</div>
    <div v-else-if="error" class="pdf-msg pdf-error">{{ error }}</div>
    <div v-if="!loading && !error && numPages > 1" class="pdf-nav">
      <button @click.stop="go(-1)" :disabled="pageNum <= 1">‹</button>
      <span>{{ pageNum }} / {{ numPages }}</span>
      <button @click.stop="go(1)" :disabled="pageNum >= numPages">›</button>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
.pdf-canvas { display: block; box-shadow: 0 2px 12px rgba(0,0,0,.15); background: #fff; }
.pdf-canvas.hidden { display: none; }
.pdf-msg { color: #9a8a74; font-size: 13px; }
.pdf-error { color: #b0524a; }
.pdf-nav {
  position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,.92);
  border: 1px solid #ddd2c2; border-radius: 14px; padding: 2px 10px; font-size: 12px; color: #6a5a48;
}
.pdf-nav button { border: 0; background: transparent; color: #6a5a48; font-size: 17px; cursor: pointer; padding: 0 6px; }
.pdf-nav button:disabled { opacity: .3; cursor: default; }
</style>
