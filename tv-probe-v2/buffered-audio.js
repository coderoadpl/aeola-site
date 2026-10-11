export class BufferedAudio {
  static async benchmark(wasmBytes, sampleRate = 48000) {
    const worker = new Worker(new URL('render-worker.js', import.meta.url), { type: 'module' })
    const channel = new MessageChannel()
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Device benchmark timed out')), 120000)
        channel.port1.onmessage = event => {
          if (event.data.type === 'fence') channel.port1.postMessage({type: 'primed'})
        }
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)) }
        worker.onmessage = event => {
          if (event.data.type === 'ready') { clearTimeout(timer); resolve(event.data.benchmark) }
          if (event.data.type === 'error') { clearTimeout(timer); reject(new Error(event.data.message)) }
        }
        worker.postMessage({type: 'initialize', wasmBytes, sampleRate, scene: 3, benchmark: true, poolSize: 1, port: channel.port2}, [channel.port2])
      })
    } finally { worker.terminate(); channel.port1.close() }
  }

  static async create(context, settings) {
    const engine = new BufferedAudio()
    try { await engine.initialize(context, settings); return engine }
    catch (error) { engine.close(); throw error }
  }

  async initialize(context, settings) {
    const capacity = 32768
    const poolSize = 16
    const shared = settings.shared !== false && globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function'
    const buffers = shared ? {
      header: new SharedArrayBuffer(8),
      left: new SharedArrayBuffer(capacity * 4),
      right: new SharedArrayBuffer(capacity * 4)
    } : {}
    this.path = shared ? 'shared' : 'transfer'
    await context.audioWorklet.addModule(new URL('buffered-worklet.js', import.meta.url))
    this.node = new AudioWorkletNode(context, 'aeola-buffered', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { capacity, poolSize, ...buffers } })
    this.worker = new Worker(new URL('render-worker.js', import.meta.url), { type: 'module' })
    const channel = new MessageChannel()
    this.node.port.postMessage({type:'port',port:channel.port1},[channel.port1])
    this.pending = []
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio preparation timed out')), 120000)
      this.worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); this.onerror?.(event.message) }
      this.node.onprocessorerror = () => { clearTimeout(timeout); reject(new Error('Audio output failed')); this.onerror?.('Audio output failed') }
      this.worker.onmessage = event => {
        const data = event.data
        if (data.type === 'ready') { clearTimeout(timeout); this.benchmark = data.benchmark; resolve() }
        if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); this.onerror?.(data.message) }
        if (data.type === 'stats') { this.workerStats = data; this.resolveStats() }
      }
      this.node.port.onmessage = event => {
        if (event.data.type === 'stats') { this.outputStats = event.data; this.resolveStats() }
      }
      this.worker.postMessage({ ...settings, ...buffers, type: 'initialize', capacity, poolSize, sampleRate: context.sampleRate, port: channel.port2 }, [channel.port2])
    })
    this.node.port.postMessage({type:'start'})
  }

  resolveStats() {
    if (!this.workerStats || !this.outputStats) return
    const stats = { ...this.workerStats, ...this.outputStats, path: this.path }
    this.workerStats = null
    this.outputStats = null
    for (const pending of this.pending) { clearTimeout(pending.timer); pending.resolve(stats) }
    this.pending.length = 0
  }

  stats() {
    return new Promise((resolve, reject) => {
      const pending = { resolve, timer: setTimeout(() => { this.pending = this.pending.filter(item => item !== pending); reject(new Error('Audio statistics timed out')) }, 3000) }
      this.pending.push(pending)
      this.worker.postMessage({type:'stats'})
      this.node.port.postMessage({type:'stats'})
    })
  }

  set(name, value) { this.worker.postMessage({type:'control',name,value}) }
  close() {
    this.node?.disconnect()
    this.node?.port.close()
    this.worker?.terminate()
    for (const pending of this.pending || []) { clearTimeout(pending.timer); pending.resolve({ closed: true, xruns: 0, renderedFrames: 0, renderMilliseconds: 0 }) }
    if (this.pending) this.pending.length = 0
  }
}
