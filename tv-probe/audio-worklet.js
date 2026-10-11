class AeolaProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const settings = options.processorOptions
    this.memory = null
    this.exports = null
    this.renderMilliseconds = 0
    this.renderedFrames = 0
    this.recordedLeft = null
    this.recordedRight = null
    this.recordedFrame = 0
    this.xruns = 0
    this.expectedFrame = null
    this.lastError = ''
    this.port.onmessage = event => {
      if (event.data.type === 'initialize') {
        this.initialize(event.data)
      } else if (event.data.type === 'stats') {
        this.port.postMessage({ type: 'stats', renderMilliseconds: this.renderMilliseconds, renderedFrames: this.renderedFrames, xruns: this.xruns, error: this.lastError })
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
    const imports = this.makeImports()
    const module = settings.wasmModule || new WebAssembly.Module(settings.wasmBytes)
    const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: imports })
    this.exports = instance.exports
    this.memory = instance.exports.memory
    this.exports._start()
    const createStatus = this.exports.aeola_web_create(sampleRate, 7n)
    const sceneStatus = this.exports.aeola_web_set_scene(settings.scene)
    const moodStatus = this.exports.aeola_web_set_mood(settings.mood || 0)
    const musicStatus = this.exports.aeola_web_set_music_under(0)
    const prepareStatus = this.exports.aeola_web_prepare()
    if ([createStatus, sceneStatus, moodStatus, musicStatus, prepareStatus].some(status => status !== 0)) {
      throw new Error(`Engine setup failed: ${[createStatus, sceneStatus, moodStatus, musicStatus, prepareStatus].join('/')}`)
    }
    this.leftPointer = this.exports.aeola_web_left_buffer()
    this.rightPointer = this.exports.aeola_web_right_buffer()
    this.samples = new Float32Array(this.memory.buffer)
    this.leftIndex = this.leftPointer >>> 2
    this.rightIndex = this.rightPointer >>> 2
    this.recordedLeft = settings.recordedLeft || null
    this.recordedRight = settings.recordedRight || null
    this.loopRecorded = Boolean(settings.loopRecorded)
    this.port.postMessage({ type: 'ready' })
  }

  makeImports() {
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
      clock_res_get: (clock, pointer) => {
        view().setBigUint64(pointer, 1000000n, true)
        return 0
      },
      clock_time_get: (clock, precision, pointer) => {
        view().setBigUint64(pointer, BigInt(Math.round(performance.now() * 1000000)), true)
        return 0
      },
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
      fd_write: (fd, iovs, count, written) => {
        view().setUint32(written, 0, true)
        return 0
      },
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
      if (this.expectedFrame !== null && currentFrame !== this.expectedFrame) this.xruns += 1
      this.expectedFrame = currentFrame + frames
      const started = Date.now()
      const renderStatus = this.exports.aeola_web_render(frames)
      const elapsed = Date.now() - started
      if (renderStatus !== 0) throw new Error(`Engine render failed: ${renderStatus}`)
      this.renderMilliseconds += elapsed
      if (elapsed > frames * 1000 / sampleRate) this.xruns += 1
      const left = output[0]
      const right = output[1]
      for (let frame = 0; frame < frames; frame += 1) {
        const recorded = this.loopRecorded && this.recordedLeft ? this.recordedFrame % this.recordedLeft.length : this.recordedFrame
        left[frame] = this.samples[this.leftIndex + frame] + (this.recordedLeft && recorded < this.recordedLeft.length ? this.recordedLeft[recorded] : 0)
        right[frame] = this.samples[this.rightIndex + frame] + (this.recordedRight && recorded < this.recordedRight.length ? this.recordedRight[recorded] : 0)
        this.recordedFrame += 1
      }
    } catch (error) {
      this.lastError = error && error.stack ? error.stack : String(error)
      this.port.postMessage({ type: 'error', message: error && error.stack ? error.stack : String(error) })
      return false
    }
    this.renderedFrames += frames
    return true
  }
}

registerProcessor('aeola-processor', AeolaProcessor)
