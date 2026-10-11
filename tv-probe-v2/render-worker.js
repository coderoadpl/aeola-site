import { CoreState } from './core-state.js'

let core, port, settings, samples, leftIndex, rightIndex, header, ringLeft, ringRight
let renderedFrames = 0, renderMilliseconds = 0, recordedFrame = 0, timer, stopped = false
let benchmark, hasSession = false
const blockFrames = 2048

function render(left, right) {
  const started = performance.now()
  const status = core.exports.aeola_web_render(blockFrames)
  if (status !== 0) throw new Error(`Render failed: ${status}`)
  if (samples.buffer !== core.memory.buffer) samples = new Float32Array(core.memory.buffer)
  const recordedLeft = settings.recordedLeft
  const recordedRight = settings.recordedRight
  for (let frame = 0; frame < blockFrames; frame += 1) {
    left[frame] = samples[leftIndex + frame] + (recordedLeft?.length ? recordedLeft[recordedFrame] : 0)
    right[frame] = samples[rightIndex + frame] + (recordedRight?.length ? recordedRight[recordedFrame] : 0)
    recordedFrame += 1
    if (recordedLeft && recordedFrame === recordedLeft.length) recordedFrame = 0
  }
  renderMilliseconds += performance.now() - started
  renderedFrames += blockFrames
}

function fillShared() {
  let write = Atomics.load(header, 1) >>> 0
  const read = Atomics.load(header, 0) >>> 0
  while (((write - read) >>> 0) + blockFrames <= settings.capacity) {
    render(settings.scratchLeft, settings.scratchRight)
    for (let frame = 0; frame < blockFrames; frame += 1) {
      const index = (write + frame) & (settings.capacity - 1)
      ringLeft[index] = settings.scratchLeft[frame]
      ringRight[index] = settings.scratchRight[frame]
    }
    write = (write + blockFrames) >>> 0
    Atomics.store(header, 1, write | 0)
  }
}

function fail(error) {
  stopped = true
  clearInterval(timer)
  self.postMessage({ type: 'error', message: String(error.stack || error) })
}

self.onmessage = async event => {
  try {
    const data = event.data
    if (data.type === 'initialize') {
      settings = data
      port = data.port
      core = new CoreState(data.wasmBytes)
      await core.initialize()
      core.exports.aeola_web_destroy()
      core.exports.aeola_web_create(data.sampleRate, 7n)
      if (data.benchmark) {
        const msPerSecond = core.exports.aeola_web_benchmark(data.sampleRate)
        benchmark = { msPerSecond, classification: ['fine', 'weak', 'tooWeak'][core.exports.aeola_web_benchmark_class(msPerSecond)] }
      }
      core.set('scene', data.scene)
      core.set('mood', data.mood || 0)
      core.set('musicUnder', data.musicUnder || 0)
      for (const name of ['musicUnderLevel', 'pulse', 'tempo']) if (data[name] != null) core.set(name, Number(data[name]))
      core.exports.aeola_web_prepare()
      hasSession = data.scene <= 2 || data.scene >= 9 || data.musicUnder > 0
      if (hasSession) core.exports.aeola_web_prepare_session()
      samples = new Float32Array(core.memory.buffer)
      leftIndex = core.exports.aeola_web_left_buffer() >>> 2
      rightIndex = core.exports.aeola_web_right_buffer() >>> 2
      port.onmessage = message => {
        try {
          if (stopped) return
          if (message.data.type === 'block') {
            render(message.data.left, message.data.right)
            port.postMessage(message.data, [message.data.left.buffer, message.data.right.buffer])
          } else if (message.data.type === 'primed') self.postMessage({ type: 'ready', benchmark })
        } catch (error) { fail(error) }
      }
      if (data.header) {
        header = new Int32Array(data.header)
        ringLeft = new Float32Array(data.left)
        ringRight = new Float32Array(data.right)
        settings.scratchLeft = new Float32Array(blockFrames)
        settings.scratchRight = new Float32Array(blockFrames)
        fillShared()
      } else {
        for (let index = 0; index < data.poolSize; index += 1) {
          const block = { type: 'block', left: new Float32Array(blockFrames), right: new Float32Array(blockFrames) }
          render(block.left, block.right)
          port.postMessage(block, [block.left.buffer, block.right.buffer])
        }
      }
      port.postMessage({type:'fence'})
      timer = setInterval(() => {
        try {
          if (header) fillShared()
          else port.postMessage({type:'recycle'})
        } catch (error) { fail(error) }
      }, 10)
    } else if (data.type === 'stats') {
      self.postMessage({ type: 'stats', renderMilliseconds, renderedFrames, benchmark })
    } else if (data.type === 'control') {
      core.set(data.name, data.value)
      if (!hasSession && data.name === 'musicUnder' && data.value > 0) { core.exports.aeola_web_prepare_session(); hasSession = true }
      samples = new Float32Array(core.memory.buffer)
    }
  } catch (error) { fail(error) }
}
