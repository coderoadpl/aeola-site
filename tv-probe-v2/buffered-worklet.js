class BufferedProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const settings = options.processorOptions
    this.capacity = settings.capacity
    this.mask = this.capacity - 1
    this.shared = Boolean(settings.header)
    this.header = this.shared ? new Int32Array(settings.header) : null
    this.left = this.shared ? new Float32Array(settings.left) : null
    this.right = this.shared ? new Float32Array(settings.right) : null
    this.slots = new Array(settings.poolSize).fill(null)
    this.readSlot = 0
    this.writeSlot = 0
    this.offset = 0
    this.queued = 0
    this.consumed = new Array(settings.poolSize).fill(null)
    this.consumedCount = 0
    this.playedFrames = 0
    this.missingFrames = 0
    this.xruns = 0
    this.starved = false
    this.started = false
    this.expectedFrame = -1
    this.frameGaps = 0
    this.port.onmessage = event => {
      if (event.data.type === 'port') {
        this.producer = event.data.port
        this.producer.onmessage = message => this.receive(message.data)
      } else if (event.data.type === 'start') {
        this.started = true
      } else if (event.data.type === 'stats') {
        this.port.postMessage({ type: 'stats', playedFrames: this.playedFrames, missingFrames: this.missingFrames, xruns: this.xruns, frameGaps: this.frameGaps })
      }
    }
  }

  receive(data) {
    if (data.type === 'block') {
      this.slots[this.writeSlot] = data
      this.writeSlot = (this.writeSlot + 1) % this.slots.length
      this.queued += 1
    }
    for (let index = 0; index < this.consumedCount; index += 1) {
      const block = this.consumed[index]
      this.producer.postMessage(block, [block.left.buffer, block.right.buffer])
      this.consumed[index] = null
    }
    this.consumedCount = 0
    if (data.type === 'fence') this.producer.postMessage({ type: 'primed' })
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!this.started || !output || output.length < 2) return true
    const count = output[0].length
    if (this.expectedFrame >= 0 && this.expectedFrame !== currentFrame) this.frameGaps += 1
    this.expectedFrame = currentFrame + count
    let copied = 0
    if (this.shared) {
      const read = Atomics.load(this.header, 0) >>> 0
      const write = Atomics.load(this.header, 1) >>> 0
      copied = Math.min(count, (write - read) >>> 0)
      for (let frame = 0; frame < copied; frame += 1) {
        const index = (read + frame) & this.mask
        output[0][frame] = this.left[index]
        output[1][frame] = this.right[index]
      }
      Atomics.store(this.header, 0, (read + copied) | 0)
    } else {
      while (copied < count && this.queued > 0) {
        const block = this.slots[this.readSlot]
        const end = Math.min(block.left.length, this.offset + count - copied)
        while (this.offset < end) {
          output[0][copied] = block.left[this.offset]
          output[1][copied] = block.right[this.offset]
          this.offset += 1
          copied += 1
        }
        if (this.offset === block.left.length) {
          this.consumed[this.consumedCount++] = block
          this.slots[this.readSlot] = null
          this.readSlot = (this.readSlot + 1) % this.slots.length
          this.queued -= 1
          this.offset = 0
        }
      }
    }
    if (copied < count) {
      if (!this.starved) this.xruns += 1
      this.missingFrames += count - copied
      this.starved = true
    } else this.starved = false
    this.playedFrames += count
    return true
  }
}
registerProcessor('aeola-buffered', BufferedProcessor)
