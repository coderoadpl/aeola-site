const checkKeys = ['userAgent', 'version', 'wasm', 'worklet', 'offline', 'aac', 'engine']
const checks = Object.fromEntries(checkKeys.map(key => [key, { passed: null, detail: '' }]))
const elements = Object.fromEntries(['checks', 'agent', 'result-code', 'status', 'meter-fill', 'meter-value', 'render-value', 'xruns-value', 'errors-value', 'error-detail', 'rain', 'forest', 'stop', 'language'].map(id => [id, document.getElementById(id)]))
const durationSeconds = new URLSearchParams(location.search).has('testSeconds') && location.hostname === '127.0.0.1' ? Math.min(30, Number(new URLSearchParams(location.search).get('testSeconds')) || 30) : 30
let strings
let language = navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en'
let wasmBytes
let active = null
let scenePlayed = '-'
let errors = 0
let xruns = 0
let renderMilliseconds = 0
let renderedFrames = 0
let chromiumVersion = 0
let tizenVersion = 0
let statusKey = null

function t(key) {
  return strings[key].localizations[language].stringUnit.value
}

function code() {
  const bits = checkKeys.map(key => checks[key].passed === null ? 'u' : checks[key].passed ? '1' : '0').join('')
  const input = `${navigator.userAgent}|${bits}|${scenePlayed}|${xruns}|${errors}|${Math.round(renderMilliseconds)}|${renderedFrames}`
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  elements['result-code'].textContent = `T${tizenVersion}-C${chromiumVersion}-${(hash >>> 0).toString(16).padStart(8, '0').slice(0, 6).toUpperCase()}`
}

function showChecks() {
  elements.checks.replaceChildren(...checkKeys.map(key => {
    const row = document.createElement('div')
    const status = document.createElement('strong')
    const name = document.createElement('span')
    const detail = document.createElement('span')
    row.className = `check ${checks[key].passed === null ? 'pending' : checks[key].passed ? 'pass' : 'fail'}`
    row.dataset.check = key
    status.textContent = t(checks[key].passed === null ? 'waiting' : checks[key].passed ? 'pass' : 'fail')
    name.textContent = t(key)
    detail.className = 'detail'
    detail.textContent = checks[key].detail ? `· ${checks[key].detail}` : ''
    row.append(status, name, detail)
    return row
  }))
  code()
}

function setCheck(key, passed, detail = '') {
  checks[key] = { passed, detail }
  showChecks()
}

function localize() {
  document.documentElement.lang = language
  document.querySelectorAll('[data-l10n]').forEach(element => { element.textContent = t(element.dataset.l10n) })
  document.title = t('title')
  if (checks.userAgent.passed !== null) checks.userAgent.detail = t(checks.userAgent.passed ? 'samsungTizen' : 'otherBrowser')
  if (statusKey) elements.status.textContent = t(statusKey)
  showChecks()
}

function setStatus(key) {
  statusKey = key
  elements.status.textContent = t(key)
}

async function fetchBytes(path) {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

async function decode(path, context, limitSeconds) {
  const audio = await context.decodeAudioData(await fetchBytes(path))
  const frames = Math.min(audio.length, Math.round(limitSeconds * context.sampleRate))
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  left.set(audio.getChannelData(0).subarray(0, frames))
  right.set(audio.getChannelData(Math.min(1, audio.numberOfChannels - 1)).subarray(0, frames))
  return { left, right, rate: audio.sampleRate }
}

function processor(context, scene, recorded) {
  const node = new AudioWorkletNode(context, 'aeola-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      wasmBytes,
      scene,
      mood: 0,
      recordedLeft: recorded && recorded.left,
      recordedRight: recorded && recorded.right,
      loopRecorded: Boolean(recorded)
    }
  })
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(t('workletTimeout'))), 20000)
    node.port.onmessage = event => {
      if (event.data.type === 'ready') {
        clearTimeout(timeout)
        resolve()
      } else if (event.data.type === 'error') {
        clearTimeout(timeout)
        if (active && active.node === node) recordError(event.data.message)
        reject(new Error(event.data.message))
      } else if (event.data.type === 'stats' && active && active.node === node) {
        renderMilliseconds = event.data.renderMilliseconds
        renderedFrames = event.data.renderedFrames
        xruns = event.data.xruns
        showMeasurements()
      }
    }
    node.onprocessorerror = () => reject(new Error(t('workletProcessorError')))
  })
  return { node, ready }
}

function recordError(error) {
  errors += 1
  elements['errors-value'].textContent = String(errors)
  elements['error-detail'].textContent = String(error)
  code()
}

function showMeasurements() {
  const seconds = renderedFrames / 48000
  elements['render-value'].textContent = seconds ? `${(renderMilliseconds / seconds).toFixed(1)} ms` : '—'
  elements['xruns-value'].textContent = String(xruns)
  code()
}

async function runChecks() {
  const agent = navigator.userAgent
  elements.agent.textContent = agent
  tizenVersion = Number(agent.match(/Tizen[ /](\d+)/i)?.[1] || 0)
  chromiumVersion = Number(agent.match(/(?:Chrome|Chromium)[/](\d+)/i)?.[1] || 0)
  setCheck('userAgent', /Tizen/i.test(agent) && /Samsung|SMART-TV/i.test(agent), /Tizen|Samsung|SMART-TV/i.test(agent) ? t('samsungTizen') : t('otherBrowser'))
  setCheck('version', tizenVersion >= 8 && chromiumVersion >= 108, `Tizen ${tizenVersion || '?'} · Chromium ${chromiumVersion || '?'}`)
  const hasWasm = typeof WebAssembly === 'object' && typeof WebAssembly.Module === 'function'
  setCheck('wasm', hasWasm)
  const hasOffline = typeof OfflineAudioContext === 'function'
  setCheck('offline', hasOffline)
  let offline
  try {
    if (!hasOffline) throw new Error(t('offlineUnavailable'))
    offline = new OfflineAudioContext(2, 128, 48000)
    setCheck('worklet', Boolean(offline.audioWorklet && typeof AudioWorkletNode === 'function'))
    if (!checks.worklet.passed) throw new Error(t('workletUnavailable'))
    const decoded = await decode('assets/aac-check.m4a', offline, 2)
    setCheck('aac', decoded.left.length > 0 && decoded.rate > 0, `${(decoded.left.length / decoded.rate).toFixed(1)} s · ${decoded.rate} Hz`)
  } catch (error) {
    if (checks.worklet.passed === null) setCheck('worklet', false, String(error))
    setCheck('aac', false, String(error))
  }
  try {
    if (!hasWasm || !checks.worklet.passed) throw new Error(t('unsupported'))
    wasmBytes = await fetchBytes('AeolaWeb.wasm')
    if (!WebAssembly.validate(wasmBytes)) throw new Error(t('invalidWasm'))
    await offline.audioWorklet.addModule('audio-worklet.js')
    const { node, ready } = processor(offline, 3, null)
    node.connect(offline.destination)
    const rendering = offline.startRendering()
    await ready
    await rendering
    node.disconnect()
    setCheck('engine', true, `${(wasmBytes.byteLength / 1048576).toFixed(1)} MiB`)
  } catch (error) {
    setCheck('engine', false, String(error))
  }
  setStatus(checks.engine.passed ? 'ready' : 'unsupported')
}

function updateMeter() {
  if (!active) return
  active.analyser.getFloatTimeDomainData(active.samples)
  let peak = 0
  for (let index = 0; index < active.samples.length; index += 1) peak = Math.max(peak, Math.abs(active.samples[index]))
  const percent = Math.min(100, Math.round(peak * 100))
  elements['meter-fill'].style.width = `${percent}%`
  elements['meter-value'].textContent = `${percent}%`
  active.node.port.postMessage({ type: 'stats' })
  const elapsed = Math.min(durationSeconds, Math.floor((performance.now() - active.started) / 1000))
  statusKey = null
  elements.status.textContent = `${elapsed} / ${durationSeconds} ${t('duration')}`
}

async function stopPlayback(finished = false) {
  if (!active) return
  const session = active
  clearInterval(session.interval)
  clearTimeout(session.timeout)
  session.node.port.postMessage({ type: 'stats' })
  await new Promise(resolve => setTimeout(resolve, 100))
  active = null
  session.node.disconnect()
  await session.context.close()
  setStatus(finished ? 'finished' : 'stopped')
  code()
}

async function play(scene) {
  if (active) await stopPlayback()
  if (!checks.worklet.passed || !checks.wasm.passed || !checks.engine.passed) {
    setStatus('unsupported')
    return
  }
  let context
  try {
    context = new AudioContext({ sampleRate: 48000 })
    await context.resume()
    setStatus('loading')
    scenePlayed = scene === 3 ? 'R' : 'F'
    xruns = 0
    errors = 0
    renderMilliseconds = 0
    renderedFrames = 0
    elements['errors-value'].textContent = '0'
    elements['error-detail'].textContent = ''
    showMeasurements()
    const recorded = scene === 6 ? await decode('assets/forest-bed.m4a', context, durationSeconds) : null
    await context.audioWorklet.addModule('audio-worklet.js')
    const { node, ready } = processor(context, scene, recorded)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    node.connect(analyser)
    analyser.connect(context.destination)
    await ready
    active = { context, node, analyser, samples: new Float32Array(analyser.fftSize), started: performance.now() }
    active.interval = setInterval(updateMeter, 250)
    active.timeout = setTimeout(() => stopPlayback(true), durationSeconds * 1000)
    updateMeter()
  } catch (error) {
    recordError(error)
    statusKey = null
    elements.status.textContent = String(error)
    if (context && context.state !== 'closed') await context.close()
  }
}

async function start() {
  strings = await (await fetch('Localizable.xcstrings')).json().then(catalog => catalog.strings)
  localize()
  elements.rain.focus()
  setStatus('waiting')
  elements.rain.addEventListener('click', () => play(3))
  elements.forest.addEventListener('click', () => play(6))
  elements.stop.addEventListener('click', () => stopPlayback())
  elements.language.addEventListener('click', () => {
    language = language === 'en' ? 'pl' : 'en'
    localize()
  })
  const buttons = [elements.rain, elements.forest, elements.stop, elements.language]
  document.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement)
    if (index < 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      buttons[(index + 1) % buttons.length].focus()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      buttons[(index + buttons.length - 1) % buttons.length].focus()
    } else if (event.key === 'Backspace' || event.keyCode === 10009) {
      event.preventDefault()
      stopPlayback()
    }
  })
  runChecks().catch(recordError)
}

start().catch(error => { elements.status.textContent = String(error) })
