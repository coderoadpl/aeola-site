export class CoreState {
  static async load() {
    const response = await fetch('AeolaWeb.wasm')
    if (!response.ok) throw new Error(String(response.status))
    const bytes = await response.arrayBuffer()
    const core = new CoreState(bytes)
    await core.initialize()
    return core
  }

  constructor(bytes) {
    this.bytes = bytes
    this.memory = null
    this.exports = null
  }

  async initialize() {
    const module = await WebAssembly.compile(this.bytes)
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: this.imports() })
    this.exports = instance.exports
    this.memory = instance.exports.memory
    this.exports._start()
    if (this.exports.aeola_web_create(48000, 7n) !== 0) throw new Error('Engine initialization failed')
  }

  set(name, value) {
    const methods = { scene: 'aeola_web_set_scene', mood: 'aeola_web_set_mood', musicUnder: 'aeola_web_set_music_under', musicUnderLevel: 'aeola_web_set_music_under_level', pulse: 'aeola_web_set_pulse', tempo: 'aeola_web_set_tempo' }
    return this.exports[methods[name]](value)
  }

  state() {
    const pointer = this.exports.aeola_web_metadata_buffer()
    const length = this.exports.aeola_web_metadata_length()
    return JSON.parse(new TextDecoder().decode(new Uint8Array(this.memory.buffer, pointer, length)))
  }

  imports() {
    const unsupported = () => 52
    const view = () => new DataView(this.memory.buffer)
    const emptyPair = (first, second) => {
      const data = view()
      data.setUint32(first, 0, true)
      data.setUint32(second, 0, true)
      return 0
    }
    return {
      args_get: () => 0,
      args_sizes_get: emptyPair,
      environ_get: () => 0,
      environ_sizes_get: emptyPair,
      clock_res_get: (clock, pointer) => { view().setBigUint64(pointer, 1000000n, true); return 0 },
      clock_time_get: (clock, precision, pointer) => { view().setBigUint64(pointer, BigInt(Math.round(performance.now() * 1000000)), true); return 0 },
      fd_close: unsupported,
      fd_fdstat_get: unsupported,
      fd_fdstat_set_flags: unsupported,
      fd_filestat_get: unsupported,
      fd_filestat_set_times: unsupported,
      fd_pread: unsupported,
      fd_prestat_get: unsupported,
      fd_prestat_dir_name: unsupported,
      fd_read: unsupported,
      fd_readdir: unsupported,
      fd_seek: unsupported,
      fd_sync: unsupported,
      fd_write: (fd, iovs, count, written) => { view().setUint32(written, 0, true); return 0 },
      path_create_directory: unsupported,
      path_filestat_get: unsupported,
      path_filestat_set_times: unsupported,
      path_link: unsupported,
      path_open: unsupported,
      path_readlink: unsupported,
      path_remove_directory: unsupported,
      path_rename: unsupported,
      path_symlink: unsupported,
      path_unlink_file: unsupported,
      poll_oneoff: unsupported,
      proc_exit: code => { throw new Error(`WASI exited with ${code}`) },
      random_get: (pointer, length) => {
        const bytes = new Uint8Array(this.memory.buffer, pointer, length)
        let state = 0x6d2b79f5
        for (let index = 0; index < length; index += 1) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          bytes[index] = state & 255
        }
        return 0
      }
    }
  }
}
