import { wasiImports } from './wasi-shim.js'

class AeolaProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const settings = options.processorOptions
    this.metrics = settings.metrics ? new Float64Array(settings.metrics) : null
    this.memory = null
    this.exports = null
    this.renderMilliseconds = 0
    this.renderedFrames = 0
    this.port.onmessage = event => {
      if (event.data.type === 'initialize') {
        this.initialize(event.data)
      } else if (event.data.type === 'control') {
        try {
          this.applyTargets(event.data.targets)
        } catch (error) {
          this.port.postMessage({ type: 'error', message: String(error) })
        }
      }
    }
    if (settings.wasmModule || settings.wasmBytes) {
      try {
        this.initialize(settings)
      } catch (error) {
        this.port.postMessage({ type: 'error', message: error && error.stack ? error.stack : String(error) })
      }
    }
  }

  initialize(settings) {
    const imports = wasiImports(() => this.memory, settings.seed)
    const module = settings.wasmModule || new WebAssembly.Module(settings.wasmBytes)
    const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: imports })
    this.exports = instance.exports
    this.memory = instance.exports.memory
    this.exports._start()
    const createStatus = this.exports.aeola_web_create(sampleRate, settings.seed ?? 7n)
    let moodStatus = 0
    let sceneStatus = 0
    let musicStatus = 0
    if (settings.targets) {
      this.applyTargets(settings.targets)
    } else {
      moodStatus = this.exports.aeola_web_set_mood(settings.mood || 0)
      sceneStatus = this.exports.aeola_web_set_scene(settings.scene)
      musicStatus = this.exports.aeola_web_set_music_under(settings.musicUnder || 0)
      if (settings.musicUnderLevel != null) this.exports.aeola_web_set_music_under_level(settings.musicUnderLevel)
      if (settings.pulse != null) this.exports.aeola_web_set_pulse(settings.pulse ? 1 : 0)
      if (settings.tempo != null) this.exports.aeola_web_set_tempo(settings.tempo)
    }
    if (this.exports.aeola_web_prepare() !== 0) throw new Error('Engine setup failed')
    this.leftPointer = this.exports.aeola_web_left_buffer()
    this.rightPointer = this.exports.aeola_web_right_buffer()
    this.samples = new Float32Array(this.memory.buffer)
    this.leftIndex = this.leftPointer >>> 2
    this.rightIndex = this.rightPointer >>> 2
    if (this.metrics) {
      this.metrics[2] = createStatus
      this.metrics[3] = sceneStatus
      this.metrics[4] = moodStatus
      this.metrics[5] = musicStatus
    }
    this.port.postMessage({ type: 'ready' })
  }

  applyTargets(targets) {
    const size = this.exports.aeola_web_target_size()
    if (!targets || targets.byteLength !== size) throw new Error('Control size mismatch')
    const pointer = this.exports.aeola_web_target_buffer()
    new Uint8Array(this.memory.buffer, pointer, size).set(targets)
    if (this.exports.aeola_web_apply_targets() !== 0) throw new Error('Control rejected')
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!output || output.length < 2) {
      return true
    }
    if (!this.exports) {
      return true
    }
    const frames = output[0].length
    try {
      const started = Date.now()
      if (this.exports.aeola_web_render(frames) !== 0) throw new Error('Engine render failed')
      this.renderMilliseconds += Date.now() - started
      if (this.samples.buffer !== this.memory.buffer) this.samples = new Float32Array(this.memory.buffer)
      const left = output[0]
      const right = output[1]
      for (let frame = 0; frame < frames; frame += 1) {
        left[frame] = this.samples[this.leftIndex + frame]
        right[frame] = this.samples[this.rightIndex + frame]
      }
    } catch (error) {
      this.port.postMessage({ type: 'error', message: error && error.stack ? error.stack : String(error) })
      return false
    }
    this.renderedFrames += frames
    if (this.metrics) {
      this.metrics[0] = this.renderMilliseconds
      this.metrics[1] = this.renderedFrames
    }
    return true
  }
}

registerProcessor('aeola-processor', AeolaProcessor)

registerProcessor('aeola-probe', class extends AudioWorkletProcessor {
  process(inputs, outputs) {
    for (const channel of outputs[0]) {
      channel.fill(0.25)
    }
    return true
  }
})
