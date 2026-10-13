export class AssetDecoder {
  constructor(base = new URL('audio-chunks/', import.meta.url)) {
    this.base = base
    this.cache = new Map()
    this.contexts = new Map()
    this.decodedPeakBytes = 0
    this.decodedBytes = 0
    this.maxChunkFrames = 0
  }

  async initialize() {
    this.index = await fetch(new URL('index.json', this.base)).then(response => {
      if (!response.ok) throw new Error(`Asset index: ${response.status}`)
      return response.json()
    })
    this.manifest = await fetch(new URL('manifest.json', this.base)).then(response => response.json())
    return this
  }

  async chunk(asset, chunk) {
    const key = chunk.file
    if (this.cache.has(key)) return this.cache.get(key)
    while (this.cache.size >= 2) {
      const first = this.cache.keys().next().value
      this.decodedBytes -= this.cache.get(first).length * 8
      this.cache.delete(first)
    }
    let context = this.contexts.get(asset.rate)
    if (!context) {
      context = new OfflineAudioContext(2, 1, asset.rate)
      this.contexts.set(asset.rate, context)
    }
    const response = await fetch(new URL(chunk.file, this.base))
    if (!response.ok) throw new Error(`Asset chunk: ${response.status}`)
    const audio = await context.decodeAudioData(await response.arrayBuffer())
    if (audio.length !== chunk.frames) throw new Error(`Chunk length ${audio.length} != ${chunk.frames}`)
    this.maxChunkFrames = Math.max(this.maxChunkFrames, audio.length)
    this.decodedBytes += audio.length * 8
    this.decodedPeakBytes = Math.max(this.decodedPeakBytes, this.decodedBytes)
    this.cache.set(key, audio)
    return audio
  }

  async read(request) {
    const asset = this.index.assets[request.asset]
    if (!asset || asset.rate !== request.rate || request.count > 8192 || request.start < 0) throw new Error('Invalid PCM request')
    const left = new Float32Array(request.count)
    const right = new Float32Array(request.count)
    let done = 0
    while (done < request.count) {
      const frame = request.start + done
      const chunk = asset.chunks.find(chunk => frame >= chunk.start && frame < chunk.start + chunk.frames)
      if (!chunk) throw new Error(`Missing PCM ${request.asset}:${frame}`)
      const audio = await this.chunk(asset, chunk)
      const offset = frame - chunk.start
      const count = Math.min(request.count - done, audio.length - offset)
      left.set(audio.getChannelData(0).subarray(offset, offset + count), done)
      right.set(audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0).subarray(offset, offset + count), done)
      done += count
    }
    return { left, right }
  }

  close() {
    this.cache.clear()
    this.contexts.clear()
    this.decodedBytes = 0
  }
}

export async function feedCore(core, read) {
  const api = core.exports
  const decoder = new TextDecoder()
  let milliseconds = 0
  for (;;) {
    const started = performance.now()
    const size = api.aeola_web_feed_request()
    milliseconds += performance.now() - started
    if (size < 0) throw new Error('PCM request failed')
    if (!size) return milliseconds
    const request = JSON.parse(decoder.decode(new Uint8Array(core.memory.buffer, api.aeola_web_input_buffer(), size)))
    const { left, right } = await read(request)
    const leftPointer = api.aeola_web_pcm_left()
    const rightPointer = api.aeola_web_pcm_right()
    new Float32Array(core.memory.buffer, leftPointer, request.count).set(left)
    new Float32Array(core.memory.buffer, rightPointer, request.count).set(right)
    const uploadStarted = performance.now()
    const status = api.aeola_web_feed_pcm(request.count)
    milliseconds += performance.now() - uploadStarted
    if (status !== 0) throw new Error('PCM upload failed')
  }
}

export function configureAssets(core, manifest) {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  if (bytes.length > 1048576) throw new Error('Asset manifest too large')
  const pointer = core.exports.aeola_web_input_buffer()
  new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes)
  if (core.exports.aeola_web_assets(bytes.length) !== 0) throw new Error('Asset preparation failed')
}
