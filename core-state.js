import { wasiImports } from './wasi-shim.js'

export class CoreState {
  static async load() {
    const response = await fetch('AeolaWeb.wasm')
    if (!response.ok) throw new Error(String(response.status))
    const bytes = await response.arrayBuffer()
    const core = new CoreState(bytes, crypto.getRandomValues(new BigUint64Array(1))[0])
    await core.initialize()
    return core
  }

  constructor(bytes, seed = 7n) {
    this.bytes = bytes
    this.seed = seed
    this.memory = null
    this.exports = null
  }

  async initialize() {
    const module = this.bytes instanceof WebAssembly.Module ? this.bytes : await WebAssembly.compile(this.bytes)
    this.module = module
    this.bytes = null
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: this.imports() })
    this.exports = instance.exports
    this.memory = instance.exports.memory
    this.exports._start()
    if (this.exports.aeola_web_create(48000, this.seed) !== 0) throw new Error('Engine initialization failed')
  }

  set(name, value) {
    const methods = { scene: 'aeola_web_set_scene', mood: 'aeola_web_set_mood', musicUnder: 'aeola_web_set_music_under', musicUnderLevel: 'aeola_web_set_music_under_level', pulse: 'aeola_web_set_pulse', tempo: 'aeola_web_set_tempo', noise: 'aeola_web_toggle_noise' }
    return this.exports[methods[name]](value)
  }

  state() {
    const pointer = this.exports.aeola_web_metadata_buffer()
    const length = this.exports.aeola_web_metadata_length()
    return JSON.parse(new TextDecoder().decode(new Uint8Array(this.memory.buffer, pointer, length)))
  }

  snapshot() {
    const size = this.exports.aeola_web_sound_state()
    if (size < 0) throw new Error('State export failed')
    return new Uint8Array(new Uint8Array(this.memory.buffer, this.exports.aeola_web_input_buffer(), size))
  }

  restore(bytes) {
    const pointer = this.exports.aeola_web_input_buffer()
    new Uint8Array(this.memory.buffer, pointer, bytes.length).set(bytes)
    if (this.exports.aeola_web_restore_state(bytes.length) !== 0) throw new Error('State restore failed')
  }

  targets() {
    const pointer = this.exports.aeola_web_resolved_targets_buffer()
    const length = this.exports.aeola_web_target_size()
    return new Uint8Array(new Uint8Array(this.memory.buffer, pointer, length))
  }

  benchmark() {
    const milliseconds = this.exports.aeola_web_benchmark(48000)
    return { milliseconds, performanceClass: this.exports.aeola_web_benchmark_class(milliseconds) }
  }

  imports() {
    return wasiImports(() => this.memory, this.seed)
  }
}
