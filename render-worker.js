import { CoreState } from './core-state.js'
import { configureAssets, feedCore } from './asset-decoder.js'

let core, port, settings, header, ringLeft, ringRight
let renderedFrames = 0, renderMilliseconds = 0, timer, stopped = false, busy = false
let benchmark, pendingPCM
const blockFrames = 2048
const recycled = []

function read(request) {
  return new Promise((resolve, reject) => {
    pendingPCM = { resolve, reject }
    self.postMessage({ type: 'pcm-request', request })
  })
}

async function render(left, right) {
  renderMilliseconds += await feedCore(core, read)
  const started = performance.now()
  if (core.exports.aeola_web_render(blockFrames) !== 0) throw new Error('Render failed')
  left.set(new Float32Array(core.memory.buffer, core.exports.aeola_web_left_buffer(), blockFrames))
  right.set(new Float32Array(core.memory.buffer, core.exports.aeola_web_right_buffer(), blockFrames))
  renderMilliseconds += performance.now() - started
  renderedFrames += blockFrames
}

async function fill() {
  if (busy || stopped) return
  busy = true
  try {
    if (header) {
      let write = Atomics.load(header, 1) >>> 0
      while (((write - (Atomics.load(header, 0) >>> 0)) >>> 0) + blockFrames <= settings.capacity) {
        await render(settings.scratchLeft, settings.scratchRight)
        for (let frame = 0; frame < blockFrames; frame += 1) {
          const index = (write + frame) & (settings.capacity - 1)
          ringLeft[index] = settings.scratchLeft[frame]
          ringRight[index] = settings.scratchRight[frame]
        }
        write = (write + blockFrames) >>> 0
        Atomics.store(header, 1, write | 0)
      }
    } else {
      while (recycled.length) {
        const block = recycled.shift()
        await render(block.left, block.right)
        port.postMessage(block, [block.left.buffer, block.right.buffer])
      }
    }
  } finally { busy = false }
}

function consumedFrames() {
  if (header) return renderedFrames - ((Atomics.load(header, 1) - Atomics.load(header, 0)) >>> 0)
  return renderedFrames - (settings.poolSize - recycled.length) * blockFrames
}

function visual(latencyFrames) {
  const count = core.exports.aeola_web_visual_signal(Math.max(0, consumedFrames() - latencyFrames))
  const values = new Float64Array(new Float64Array(core.memory.buffer, core.exports.aeola_web_visual_signal_buffer(), count))
  self.postMessage({ type: 'visual', values }, [values.buffer])
}

function fail(error) {
  stopped = true
  clearInterval(timer)
  self.postMessage({ type: 'error', message: String(error.stack || error) })
}

self.onmessage = async event => {
  try {
    const data = event.data
    if (data.type === 'pcm') {
      const pending = pendingPCM
      pendingPCM = null
      if (data.error) pending?.reject(new Error(data.error))
      else pending?.resolve(data)
    } else if (data.type === 'initialize') {
      settings = data
      port = data.port
      core = new CoreState(data.wasmModule || data.wasmBytes, data.seed ?? 7n)
      await core.initialize()
      core.exports.aeola_web_destroy()
      core.exports.aeola_web_create(data.sampleRate, data.seed ?? 7n)
      if (data.benchmark) {
        const msPerSecond = core.exports.aeola_web_benchmark(data.sampleRate)
        benchmark = { msPerSecond, classification: ['fine', 'weak', 'tooWeak'][core.exports.aeola_web_benchmark_class(msPerSecond)] }
      }
      for (const name of ['scene', 'mood', 'musicUnder', 'musicUnderLevel', 'pulse', 'tempo']) {
        if (data[name] != null && core.set(name, Number(data[name])) !== 0) throw new Error(`Invalid control: ${name}`)
      }
      if (data.soundState) core.restore(data.soundState)
      if (data.manifest) {
        configureAssets(core, data.manifest)
        await feedCore(core, read)
      }
      if (core.exports.aeola_web_prepare_session() !== 0) throw new Error('Session preparation failed')
      port.onmessage = message => {
        if (stopped) return
        if (message.data.type === 'block') { recycled.push(message.data); fill().catch(fail) }
        else if (message.data.type === 'primed') self.postMessage({ type: 'ready', benchmark })
      }
      if (data.header) {
        header = new Int32Array(data.header)
        ringLeft = new Float32Array(data.left)
        ringRight = new Float32Array(data.right)
        settings.scratchLeft = new Float32Array(blockFrames)
        settings.scratchRight = new Float32Array(blockFrames)
      } else {
        for (let index = 0; index < data.poolSize; index += 1) recycled.push({ type: 'block', left: new Float32Array(blockFrames), right: new Float32Array(blockFrames) })
      }
      await fill()
      port.postMessage({ type: 'fence' })
      timer = setInterval(() => {
        if (header) fill().catch(fail)
        else port.postMessage({ type: 'recycle' })
      }, 10)
    } else if (data.type === 'stats') {
      self.postMessage({ type: 'stats', renderMilliseconds, renderedFrames, benchmark, wasmBytes: core.memory.buffer.byteLength })
    } else if (data.type === 'visual') {
      if (timer && !stopped) visual(data.latencyFrames)
    } else if (data.type === 'control') {
      if (core.set(data.name, data.value) !== 0) throw new Error(`Invalid control: ${data.name}`)
    }
  } catch (error) { fail(error) }
}
