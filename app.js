import { CoreState } from './core-state.js'
import { BufferedAudio } from './buffered-audio.js'
import { icons } from './icons.js'
import { symbolIcons } from './symbol-icons.js'

const icon = name => icons[symbolIcons[name] || name] || icons.sparkles

const store = {
  volume: Number(localStorage.getItem('aeola.volume') ?? 75),
  language: localStorage.getItem('aeola.language') || (navigator.language.startsWith('pl') ? 'pl' : 'en'),
  visualizerMode: localStorage.getItem('aeola.visualizerMode') || 'waveform'
}
const $ = id => document.getElementById(id)
const persist = (key, value) => localStorage.setItem(`aeola.${key}`, String(value))
let strings = {}
let identity = null
let creditAssets = null
let creditLanguage = null
let core = null
let coreReady = null
let state = null
let context = null
let node = null
let gain = null
let analyser = null
let mediaElement = null
let ready = null
let restart = Promise.resolve()
let playing = false
let hasEverPlayed = false
let loading = false
let error = ''
let playedSeconds = 0
let playedAt = 0
let sleepDeadline = 0
let sleepFading = false
let visualizerFrame = 0
let visualizerTime = 0
let visualizerValues = null
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const coarsePointer = matchMedia('(pointer: coarse)')
const tvMode = /Tizen/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('tv') === '1'
const tvScales = { compact: 0.88, standard: 1, large: 1.2 }
let bandCollapsed = false
let weakDeviceNotice = false
let scenesRenderKey = ''
let controlsRenderKey = ''
let layersRenderKey = ''

function t(key) {
  if (key && typeof key === 'object') {
    let index = 0
    return t(key.key).replace(/%(?:(\d+)\$)?(?:@|lld)/g, (_, position) => t(key.arguments[position ? Number(position) - 1 : index++]))
  }
  return strings[key]?.[store.language] || String(key)
}
function capitalized(value) { return value ? value[0].toLocaleUpperCase(store.language === 'pl' ? 'pl-PL' : 'en-US') + value.slice(1) : value }
function scene(id) { return state?.scenes.find(item => item.id === id) }
function groups() { return (state?.groups || []).map(group => ({ ...group, members: group.members.filter(id => scene(id)?.available) })).filter(group => group.members.length) }
function groupFor(id) { return groups().find(group => group.members.includes(id)) }
function button(label, className, selected, action) {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = label
  element.className = className + (selected ? ' selected' : '')
  element.setAttribute('aria-pressed', String(selected))
  element.addEventListener('click', action)
  return element
}
function segmented(items, selected, action) {
  const row = document.createElement('div')
  row.className = 'segmented'
  for (const [value, label] of items) row.append(button(label, '', selected === value, () => action(value)))
  return row
}
function setText(id, value) { if ($(id).textContent !== value) $(id).textContent = value }
function alignSessionCaption() {
  const clearance = Math.max($('layers').getBoundingClientRect().width, $('band-toggle').getBoundingClientRect().width) + 8
  document.querySelector('.hero-caption').style.setProperty('--caption-side-width', `${clearance}px`)
}
function focusPath(root) {
  if (!root.contains(document.activeElement)) return null
  const path = []
  for (let element = document.activeElement; element !== root; element = element.parentElement) {
    path.unshift([...element.parentElement.children].indexOf(element))
  }
  return path
}
function restoreFocus(root, path) {
  if (!path) return
  let element = root
  for (const index of path) element = element?.children[index]
  if (element?.matches('button, input, a')) element.focus({ preventScroll: true })
}
function sessionCaption() {
  const elapsed = playedSeconds + (playing ? Math.floor((Date.now() - playedAt) / 1000) : 0)
  if (!playing && !hasEverPlayed) return t(tvMode ? 'Select play or press play on the remote' : coarsePointer.matches ? 'Tap to play' : 'Press space to play')
  if (elapsed < 60) return t(playing ? 'Playing for under a minute' : 'Paused')
  const minutes = Math.floor(elapsed / 60)
  const amount = minutes < 60 ? t({ key: '%lld min', arguments: [String(minutes)] }) : t({ key: '%1$lld h %2$@ min', arguments: [String(Math.floor(minutes / 60)), String(minutes % 60).padStart(2, '0')] })
  return t({ key: playing ? 'Playing for %@' : 'Paused · %@', arguments: [amount] })
}
function timerCaption() {
  return sleepDeadline ? t({ key: 'Sleep timer · stops at %@', arguments: [new Date(sleepDeadline).toLocaleTimeString(store.language === 'pl' ? 'pl-PL' : 'en-GB', { hour: '2-digit', minute: '2-digit' })] }) : t('Sleep timer')
}

function render() {
  if (creditAssets && creditLanguage !== store.language) renderCredits(creditAssets)
  document.documentElement.lang = store.language
  $('lang-en').classList.toggle('active', store.language === 'en')
  $('lang-pl').classList.toggle('active', store.language === 'pl')
  setText('privacy', t('Privacy'))
  setText('support', t('Support'))
  setText('footer-privacy', t('Privacy'))
  setText('footer-support', t('Support'))
  setText('download-label', t('Download'))
  setText('tv-size-title', t('Interface size'))
  for (const [value, key] of [['compact', 'Compact|interface size'], ['standard', 'Standard|interface size'], ['large', 'Large|interface size']]) {
    if ($(`tv-size-${value}`)) setText(`tv-size-${value}`, t(key))
  }
  setText('time-status', t('Adaptive off'))
  $('time-icon').innerHTML = icon('sun')
  $('time-trigger').setAttribute('aria-label', t('What time of day changes'))
  setText('time-title', t('What time of day changes'))
  setText('time-body', t('Time of day info'))
  setText('time-close', t('Close'))
  for (const [id, name, label] of [['visualizer-shortcut', 'activity', 'Visualizer']]) {
    $(id).innerHTML = icon(name)
    $(id).setAttribute('aria-label', t(label))
    $(id).title = t(label)
  }
  if (identity?.storesLive) {
    $('app-store').querySelector('img').alt = t('Download on the App Store')
    $('google-play').querySelector('img').alt = t('Get it on Google Play')
    $('app-store').querySelector('img').src = `badges/app-store-${store.language}.svg`
    $('google-play').querySelector('img').src = `badges/google-play-${store.language}.png`
  } else {
    setText('app-store', t('Coming soon to the App Store'))
    setText('google-play', t('Coming soon to Google Play'))
  }
  setText('scene-label', t('Scene'))
  setText('credits-trigger', t('Recorded sound credits'))
  setText('credits-title', t('Recorded nature sound credits'))
  setText('credits-close', t('Close'))
  $('credits-trigger').hidden = !document.querySelector('#credits-list .credit')
  setText('info-close', t('Close'))
  setText('device-notice-text', t('Sound is generated live. On slower devices, especially TVs, playback may stutter. Try a lighter scene such as Rain or Noise.'))
  setText('device-notice-close', t('Close'))
  $('device-notice').hidden = !weakDeviceNotice
  const appleLegal = identity?.storesLive ? `${t('Apple and the Apple logo are trademarks of Apple Inc., registered in the U.S. and other countries.')} ${t('App Store is a service mark of Apple Inc.')}` : t('App Store is a service mark of Apple Inc.')
  const googleLegal = t(identity?.storesLive ? 'Google Play and the Google Play logo are trademarks of Google LLC.' : 'Google Play is a trademark of Google LLC.')
  setText('legal', `${appleLegal} ${googleLegal} ${t('Published by CodeRoad sp. z o.o.')} · kontakt@coderoad.pl`)
  const tabs = (state?.visualizerTabs || []).filter(tab => tab === 'waveform' || tab === 'spectrum')
  const mode = tabs.includes(store.visualizerMode) ? store.visualizerMode : 'waveform'
  setText('layers-label', t(mode[0].toUpperCase() + mode.slice(1)))
  requestAnimationFrame(alignSessionCaption)
  if (!$('layers-chevron').firstChild) $('layers-chevron').innerHTML = icon('chevron-down')
  setText('layers-title', t('Visualizer mode'))
  setText('layers-close', t('Close'))
  document.querySelector('.band').dataset.mode = mode
  document.querySelector('.band').classList.toggle('collapsed', bandCollapsed)
  $('band-toggle').setAttribute('aria-expanded', String(!bandCollapsed))
  $('band-toggle').setAttribute('aria-label', t(bandCollapsed ? 'Show visualizer' : 'Hide visualizer'))
  $('band-toggle').innerHTML = icon(bandCollapsed ? 'chevron-down' : 'chevron-up')
  $('volume-low').innerHTML = icon('volume-1')
  $('volume-high').innerHTML = icon('volume-2')
  $('volume').value = store.volume
  $('volume').style.setProperty('--fill', `${store.volume}%`)
  $('volume').setAttribute('aria-label', t('Set volume'))
  const descriptor = scene(state?.scene)
  if (!descriptor) {
    setText('hero-eyebrow', error ? t('Audio unavailable') : t('Loading engine…'))
    setText('session-status', error)
    return
  }
  setText('hero-eyebrow', error ? t('Audio unavailable') : loading ? t('Loading audio…') : playing ? t('NOW PLAYING') : hasEverPlayed ? t('PAUSED') : t('READY'))
  setText('hero-title', capitalized(t(state.nowPlayingTitle)))
  $('hero-icon').innerHTML = icon(descriptor.symbol)
  setText('hero-summary', capitalized(t(state.caption)))
  setText('session-status', error ? t('Audio unavailable') : sessionCaption())
  setText('timer-status', sleepDeadline ? sleepFading ? t('Sleep timer · fading out') : timerCaption() : '')
  $('timer-status').hidden = !sleepDeadline
  if (navigator.mediaSession && identity) {
    const title = capitalized(t(state.nowPlayingTitle))
    if (navigator.mediaSession.metadata?.title !== title) navigator.mediaSession.metadata = new MediaMetadata({ title, artist: identity.displayName })
  }
  $('transport').classList.toggle('playing', playing)
  $('transport').setAttribute('aria-label', playing ? t('Pause') : t('Play'))
  $('transport-icon').innerHTML = icon(playing ? 'pause' : 'play')
  const [top, bottom, orbOne, orbTwo, orbThree, orbFour, accent, onAccent] = state.palette
  const colors = { '--palette-top': top, '--palette-bottom': bottom, '--palette-orb-one': orbOne, '--palette-orb-two': orbTwo, '--palette-orb-three': orbThree, '--palette-orb-four': orbFour, '--mint': accent, '--on-accent': onAccent }
  for (const [name, color] of Object.entries(colors)) document.documentElement.style.setProperty(name, color)
  document.body.classList.toggle('is-playing', playing)
  $('sleep-timer').innerHTML = icon('moon-star')
  $('sleep-timer').setAttribute('aria-label', timerCaption())
  $('sleep-timer').title = timerCaption()
  $('sleep-timer').classList.toggle('selected', Boolean(sleepDeadline))
  renderScenes()
  renderControls()
  renderLayers()
}

function renderLayers() {
  const key = `${store.language}:${store.visualizerMode}`
  if (key === layersRenderKey) return
  layersRenderKey = key
  const list = $('layers-list')
  list.replaceChildren()
  for (const mode of (state?.visualizerTabs || []).filter(tab => tab === 'waveform' || tab === 'spectrum')) {
    const label = t(mode[0].toUpperCase() + mode.slice(1))
    list.append(button(label, 'visualizer-option', store.visualizerMode === mode, () => {
      store.visualizerMode = mode
      persist('visualizerMode', mode)
      $('layers-dialog').close()
      render()
    }))
  }
}

function renderScenes() {
  const key = JSON.stringify([store.language, state.scene, state.groups])
  if (key === scenesRenderKey) return
  scenesRenderKey = key
  const grid = $('scene-grid')
  const sub = $('sub-scenes')
  const gridFocus = focusPath(grid)
  const subFocus = focusPath(sub)
  grid.replaceChildren()
  groups().forEach((group, index) => {
    const chosen = group.selected
    const item = scene(chosen)
    const tile = button('', 'scene-tile', group.members.includes(state.scene), () => selectScene(chosen))
    tile.setAttribute('aria-label', `${t(group.title)}${group.members.length > 1 ? ` · ${t(item?.name || '')}` : ''}`)
    const tileIcon = document.createElement('span')
    tileIcon.className = 'tile-icon'
    tileIcon.innerHTML = icon(group.symbol)
    const title = document.createElement('span')
    title.className = 'tile-title'
    title.textContent = t(group.title)
    tile.append(tileIcon, title)
    if (group.members.length > 1) {
      const subtitle = document.createElement('span')
      subtitle.className = 'tile-subtitle'
      subtitle.textContent = t(group.subtitle)
      tile.append(subtitle)
    }
    const shortcut = document.createElement('span')
    shortcut.className = 'tile-shortcut'
    shortcut.textContent = String(index + 1)
    tile.append(shortcut)
    grid.append(tile)
  })
  const active = groupFor(state.scene)
  sub.replaceChildren()
  if (active?.members.length > 1) {
    for (const id of active.members) {
      const item = scene(id)
      const chip = button(t(item?.name || id), '', id === state.scene, () => selectScene(id))
      chip.insertAdjacentHTML('afterbegin', icon(item?.symbol))
      sub.append(chip)
    }
  }
  restoreFocus(grid, gridFocus)
  restoreFocus(sub, subFocus)
}

function renderControls() {
  const key = JSON.stringify([store.language, state.scene, state.kind, state.mood, state.musicUnder, state.musicUnderLevel, state.pulse, state.tempo, state.noiseColors])
  if (key === controlsRenderKey) return
  controlsRenderKey = key
  const body = $('controls-body')
  const controlFocus = focusPath(body)
  body.replaceChildren()
  const kind = state.kind
  if (kind === 'none') return
  const heading = document.createElement('div')
  heading.className = 'control-heading'
  const label = document.createElement('span')
  label.className = 'eyebrow'
  label.textContent = t(state.controlHeading).toUpperCase()
  const info = document.createElement('button')
  info.type = 'button'
  info.className = 'info-mark'
  info.innerHTML = icon('info')
  info.setAttribute('aria-label', t('About this control'))
  info.onclick = () => {
    setText('info-title', label.textContent)
    const options = state.controlOptions.map(option => `${t(option.title)}${option.caption ? ` · ${capitalized(t(option.caption))}` : ''}\n${t(option.info)}`)
    setText('info-body', options.join('\n\n'))
    $('info-dialog').showModal()
  }
  heading.append(label, info)
  body.append(heading)
  const row = document.createElement('div')
  row.className = 'control-row'
  if (kind === 'moods' || kind === 'energeticMoods') {
    const cards = document.createElement('div')
    cards.className = 'mood-cards'
    for (const option of state.options) {
      const card = button(t(option.label), 'mood-card', state.mood === option.id, () => setControl('mood', option.code))
      card.insertAdjacentHTML('afterbegin', icon(state.controlOptions.find(copy => copy.id === option.id)?.symbol || 'leaf'))
      cards.append(card)
    }
    row.append(cards)
  } else if (kind === 'musicUnder') {
    row.append(segmented(state.options.map(option => [option.id, t(option.label)]), state.musicUnder, value => setControl('musicUnder', state.options.find(option => option.id === value).code, value)))
    const level = document.createElement('span')
    level.className = 'level-label'
    level.textContent = t('Level')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.className = 'level-range'
    slider.value = Math.round(state.musicUnderLevel * 100)
    slider.setAttribute('aria-label', t('Level'))
    slider.addEventListener('input', () => {
      const value = Number(slider.value) / 100
      if (core.set('musicUnderLevel', value) !== 0) return
      state = core.state()
      persistSoundState()
      slider.style.setProperty('--fill', `${slider.value}%`)
      node?.set('musicUnderLevel', value)
    })
    slider.addEventListener('change', render)
    slider.style.setProperty('--fill', `${slider.value}%`)
    const levelRow = document.createElement('div')
    levelRow.className = 'level-control'
    levelRow.append(level, slider)
    row.append(levelRow)
  }
  body.append(row)
  if (kind === 'pulse') {
    const colors = document.createElement('div')
    colors.className = 'noise-colors'
    for (const option of state.noiseOptions) {
      const chip = button(t(option.label), 'noise-chip', state.noiseColors.includes(option.id), () => setControl('noise', option.code))
      const dot = document.createElement('i')
      dot.className = `noise-dot ${option.id}`
      chip.prepend(dot)
      colors.append(chip)
    }
    body.append(colors)
  }
  if (kind === 'pulse' || kind === 'musicUnder') {
    const pulseRow = document.createElement('div')
    pulseRow.className = 'control-row pulse-row'
    const pulse = button(t('Pulse'), 'pulse-button', state.pulse, () => setControl('pulse', state.pulse ? 0 : 1))
    pulse.setAttribute('aria-label', `${t('Pulse')} ${state.pulse ? t('On') : t('Off')}`)
    pulse.insertAdjacentHTML('beforeend', '<span class="switch-track"><i></i></span>')
    pulseRow.append(pulse)
    if (state.pulse) {
      const stepper = document.createElement('div')
      stepper.className = 'tempo-stepper'
      const decrease = button('', 'tempo-button', false, () => setControl('tempo', state.tempo - 5))
      const increase = button('', 'tempo-button', false, () => setControl('tempo', state.tempo + 5))
      decrease.innerHTML = icon('minus')
      increase.innerHTML = icon('plus')
      decrease.setAttribute('aria-label', t('Decrease tempo'))
      increase.setAttribute('aria-label', t('Increase tempo'))
      stepper.append(decrease, document.createTextNode(`${state.tempo} BPM`), increase)
      pulseRow.append(stepper)
    }
    body.append(pulseRow)
  }
  const caption = document.createElement('p')
  caption.className = 'control-caption'
  caption.textContent = capitalized(t(state.controlCaption))
  body.append(caption)
  restoreFocus(body, controlFocus)
}

async function ensureEngine() {
  if (ready) return ready
  ready = (async () => {
    if (!window.isSecureContext || !window.AudioWorkletNode) throw new Error(t('Use HTTPS to play audio.'))
    await coreReady
    if (!context) context = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' })
    if (navigator.audioSession) navigator.audioSession.type = 'playback'
    gain = context.createGain()
    gain.gain.value = 0
    analyser = context.createAnalyser()
    analyser.fftSize = 1024
    visualizerValues = new Uint8Array(analyser.frequencyBinCount)
    const stream = context.createMediaStreamDestination()
    mediaElement = document.createElement('audio')
    mediaElement.playsInline = true
    mediaElement.srcObject = stream.stream
    mediaElement.style.display = 'none'
    document.body.append(mediaElement)
    node = await BufferedAudio.create(context, {
      wasmModule: core.module, seed: core.seed,
      soundState: core.snapshot()
    })
    node.onerror = handleEngineError
    node.node.connect(gain).connect(analyser).connect(stream)
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: capitalized(t(state.nowPlayingTitle)), artist: identity.displayName })
      navigator.mediaSession.setActionHandler('play', () => { if (!playing) togglePlayback() })
      navigator.mediaSession.setActionHandler('pause', () => { if (playing) togglePlayback() })
      navigator.mediaSession.setActionHandler('stop', () => { if (playing) togglePlayback() })
    }
  })().catch(cause => { ready = null; throw cause })
  return ready
}

function handleEngineError(message) {
  error = String(message)
  if (playing) playedSeconds += Math.floor((Date.now() - playedAt) / 1000)
  playing = false
  cancelAnimationFrame(visualizerFrame)
  mediaElement?.pause()
  node?.close()
  node = null
  ready = null
  context?.suspend()
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
  render()
}

function persistSoundState() {
  localStorage.setItem('aeola.soundState', new TextDecoder().decode(core.snapshot()))
}

function setControl(name, value) {
  if (core) {
    if (core.set(name, value) !== 0) return
    state = core.state()
    persistSoundState()
    render()
  }
  if (node && name !== 'scene' && name !== 'musicUnder') node.set(name, value)
  else if (node) restartAudio().catch(handleEngineError)
}

function restartAudio() {
  restart = restart.catch(() => {}).then(async () => {
    node?.close()
    node = null
    ready = null
    mediaElement?.pause()
    mediaElement?.remove()
    if (!playing) return
    await ensureEngine()
    if (playing) {
      await mediaElement.play()
      gain.gain.setTargetAtTime(store.volume / 100, context.currentTime, 0.04)
    } else {
      node?.close()
      node = null
      ready = null
    }
  })
  return restart
}

async function selectScene(id) {
  if (!scene(id)) return
  error = ''
  try {
    setControl('scene', scene(id).code)
    setText('scene-announcer', capitalized(t(state.nowPlayingTitle)))
  } catch (cause) { error = String(cause); render() }
}

async function togglePlayback() {
  if (loading) return
  try {
    if (!playing) {
      error = ''
      loading = true
      render()
      if (!context) context = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' })
      const resumed = context.resume()
      await ensureEngine()
      await resumed
      await mediaElement.play()
      gain.gain.setTargetAtTime(store.volume / 100, context.currentTime, 0.04)
      playing = true
      hasEverPlayed = true
      playedAt = Date.now()
      drawVisualizer()
    } else {
      gain.gain.setTargetAtTime(0, context.currentTime, 0.04)
      await new Promise(resolve => setTimeout(resolve, 180))
      mediaElement.pause()
      node?.close()
      node = null
      ready = null
      mediaElement.remove()
      await context.suspend()
      playedSeconds += Math.floor((Date.now() - playedAt) / 1000)
      playing = false
      cancelAnimationFrame(visualizerFrame)
      document.querySelectorAll('.wave').forEach(path => path.setAttribute('d', 'M0 90 H900'))
      document.querySelectorAll('.wave-fill').forEach(path => path.setAttribute('d', 'M0 90 H900 V180 H0 Z'))
      document.querySelectorAll('.spectrum-bars i').forEach(bar => { bar.style.height = '2px' })
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    loading = false
    render()
  } catch (cause) { loading = false; error = String(cause); render() }
}

function renderCredits(assets) {
  creditAssets = assets
  creditLanguage = store.language
  const list = $('credits-list')
  list.replaceChildren()
  const delivery = document.createElement('p')
  delivery.textContent = t('Web playback uses short FLAC chunks of these recordings.')
  list.append(delivery)
  for (const asset of assets) {
    if (!asset.credit) continue
    const row = document.createElement('div')
    row.className = 'credit'
    const title = document.createElement('strong')
    title.textContent = `${asset.credit.title} · ${asset.credit.author}`
    const detail = document.createElement('span')
    detail.textContent = `${t(asset.scene[0].toUpperCase() + asset.scene.slice(1))} · ${asset.credit.changes}`
    const link = document.createElement('a')
    link.href = asset.credit.page
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = asset.credit.page
    const licence = document.createElement('a')
    licence.href = asset.credit.licenceUrl
    licence.target = '_blank'
    licence.rel = 'noopener noreferrer'
    licence.textContent = asset.credit.licence
    row.append(title, detail, document.createElement('br'), link, document.createTextNode(' · '), licence)
    list.append(row)
  }
  const iconsRow = document.createElement('div')
  iconsRow.className = 'credit'
  iconsRow.textContent = t('Icons: Lucide (ISC)')
  list.append(iconsRow)
  $('credits-trigger').hidden = !assets.length
}

function moveFocus(key) {
  const focused = document.activeElement
  const surface = document.querySelector('dialog[open]') || document
  const buttons = [...surface.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')].filter(item => item.getClientRects().length)
  if (!focused || !buttons.includes(focused)) { $('transport').focus(); return }
  const source = focused.getBoundingClientRect()
  const x = source.left + source.width / 2
  const y = source.top + source.height / 2
  const options = buttons.filter(item => item !== focused).map(item => {
    const rect = item.getBoundingClientRect()
    const dx = rect.left + rect.width / 2 - x
    const dy = rect.top + rect.height / 2 - y
    const forward = key === 'ArrowRight' ? dx > 1 : key === 'ArrowLeft' ? dx < -1 : key === 'ArrowDown' ? dy > 1 : dy < -1
    return { item, score: (key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dx) + Math.abs(dy) * 2 : Math.abs(dy) + Math.abs(dx) * 2), forward }
  }).filter(option => option.forward).sort((a, b) => a.score - b.score)
  options[0]?.item.focus()
}

function smoothBand(values, amplitude, offset) {
  const points = []
  for (let index = 0; index <= 60; index += 1) {
    const x = index * 15
    const sample = (values[index * 8] + values[index * 8 + 1] + values[index * 8 + 2]) / 3 - 128
    const envelope = Math.sin(Math.PI * index / 60) ** 0.8
    points.push([x, Math.max(12, Math.min(168, 90 + offset + envelope * sample * amplitude))])
  }
  let path = `M0 ${points[0][1]}`
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index]
    const [previousX, previousY] = points[index - 1]
    path += ` Q${previousX} ${previousY} ${(previousX + x) / 2} ${(previousY + y) / 2}`
  }
  path += ` T900 ${points.at(-1)[1]}`
  return path
}

function drawVisualizer(time = 0) {
  if (!playing || !analyser || bandCollapsed || document.hidden) return
  visualizerFrame = requestAnimationFrame(drawVisualizer)
  if (time - visualizerTime < 1000 / 30 || reducedMotion.matches) return
  visualizerTime = time
  const values = visualizerValues
  const mode = document.querySelector('.band').dataset.mode
  if (mode === 'spectrum') {
    analyser.getByteFrequencyData(values)
    document.querySelectorAll('.spectrum-bars i').forEach((bar, index) => {
      bar.style.height = `${Math.max(2, values[Math.min(values.length - 1, index * 4)] / 255 * 75)}px`
    })
    return
  }
  analyser.getByteTimeDomainData(values)
  const back = smoothBand(values, mode === 'waveform' ? 0.4 : 0.7, -8)
  const front = smoothBand(values, mode === 'waveform' ? 0.65 : 0.9, 8)
  document.querySelector('.wave-back').setAttribute('d', back)
  document.querySelector('.wave-front').setAttribute('d', front)
  document.querySelector('.wave-fill-back').setAttribute('d', `${back} L900 180 H0 Z`)
  document.querySelector('.wave-fill-front').setAttribute('d', `${front} L900 180 H0 Z`)
}

function updateClock() {
  if (sleepDeadline && playing && !sleepFading && sleepDeadline - Date.now() <= 30000) {
    sleepFading = true
    gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime)
    gain.gain.linearRampToValueAtTime(0, context.currentTime + Math.max(0, (sleepDeadline - Date.now()) / 1000))
  }
  if (sleepDeadline && Date.now() >= sleepDeadline) {
    sleepDeadline = 0
    sleepFading = false
    if (playing) togglePlayback()
  }
  if (!state) return
  if (playing) setText('session-status', sessionCaption())
  if (sleepDeadline) setText('timer-status', sleepFading ? t('Sleep timer · fading out') : timerCaption())
  $('sleep-timer').setAttribute('aria-label', timerCaption())
  $('sleep-timer').title = timerCaption()
}

async function start() {
  strings = await fetch('strings.json').then(response => response.json())
  identity = await fetch('identity.json').then(response => response.json())
  document.title = identity.displayName
  document.querySelector('.brand').setAttribute('aria-label', identity.displayName)
  document.querySelector('.brand strong').textContent = identity.displayName
  if (identity.storesLive) {
    for (const [id, url, source, label] of [['app-store', identity.appStoreUrl, 'badges/app-store-en.svg', 'Download on the App Store'], ['google-play', identity.googlePlayUrl, 'badges/google-play-en.png', 'Get it on Google Play']]) {
      const link = document.createElement('a')
      link.id = id
      link.className = 'store-coming'
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      const badge = document.createElement('img')
      badge.src = source
      badge.alt = t(label)
      link.append(badge)
      $(id).replaceWith(link)
    }
  }
  for (let index = 0; index < 42; index += 1) {
    const bar = document.createElement('i')
    bar.style.height = '2px'
    document.querySelector('.spectrum-bars').append(bar)
  }
  $('lang-en').onclick = () => { store.language = 'en'; persist('language', 'en'); render() }
  $('lang-pl').onclick = () => { store.language = 'pl'; persist('language', 'pl'); render() }
  if (tvMode) {
    document.body.classList.add('tv')
    const selectedSize = tvScales[localStorage.getItem('aeola.tvSize')] ? localStorage.getItem('aeola.tvSize') : 'standard'
    const sizeChoices = [['compact', 'Compact|interface size'], ['standard', 'Standard|interface size'], ['large', 'Large|interface size']]
    const sizeButtons = segmented(sizeChoices.map(([value, key]) => [value, t(key)]), selectedSize, size => {
      persist('tvSize', size)
      document.documentElement.style.setProperty('--tv-scale', tvScales[size])
      for (const button of $('tv-size').querySelectorAll('button')) {
        const active = button.id === `tv-size-${size}`
        button.classList.toggle('selected', active)
        button.setAttribute('aria-pressed', String(active))
      }
    })
    for (const [index, [value]] of sizeChoices.entries()) sizeButtons.children[index].id = `tv-size-${value}`
    $('tv-size').replaceChildren(sizeButtons)
    document.documentElement.style.setProperty('--tv-scale', tvScales[selectedSize])
  }
  $('transport').onclick = togglePlayback
  $('volume').oninput = event => { store.volume = Number(event.target.value); persist('volume', store.volume); event.target.style.setProperty('--fill', `${store.volume}%`); if (gain) gain.gain.setTargetAtTime(store.volume / 100, context.currentTime, 0.035) }
  $('sleep-timer').onclick = () => { const durations = state.sleepTimerChoices; const current = sleepDeadline ? Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 60000)) : 0; const next = durations.find(value => value > current) || 0; sleepDeadline = next ? Date.now() + next * 60000 : 0; if (sleepFading) { sleepFading = false; gain?.gain.cancelScheduledValues(context.currentTime); gain?.gain.setTargetAtTime(store.volume / 100, context.currentTime, 0.04) } render() }
  $('time-trigger').onclick = () => $('time-dialog').showModal()
  $('time-close').onclick = () => $('time-dialog').close()
  $('device-notice-close').onclick = () => { weakDeviceNotice = false; $('device-notice').hidden = true }
  $('info-close').onclick = () => $('info-dialog').close()
  $('visualizer-shortcut').onclick = () => $('layers-dialog').showModal()
  $('credits-trigger').onclick = () => $('credits-dialog').showModal()
  $('credits-close').onclick = () => $('credits-dialog').close()
  $('layers').onclick = () => $('layers-dialog').showModal()
  const captionControls = new ResizeObserver(alignSessionCaption)
  captionControls.observe($('layers'))
  captionControls.observe($('band-toggle'))
  $('band-toggle').onclick = () => { bandCollapsed = !bandCollapsed; if (bandCollapsed) cancelAnimationFrame(visualizerFrame); else if (playing) drawVisualizer(); render() }
  $('layers-close').onclick = () => $('layers-dialog').close()
  document.addEventListener('keydown', async event => {
    if (event.key === 'Escape' || event.keyCode === 10009) {
      const dialog = document.querySelector('dialog[open]')
      if (dialog) { event.preventDefault(); dialog.close() }
      else if (event.keyCode === 10009 && window.tizen?.application) {
        event.preventDefault()
        if (playing) await togglePlayback()
        window.tizen.application.getCurrentApplication().exit()
      }
      return
    }
    if (event.key === 'MediaPlayPause' || event.keyCode === 10252) { event.preventDefault(); togglePlayback(); return }
    if (event.key === 'MediaPlay' || event.keyCode === 415) { event.preventDefault(); if (!playing) togglePlayback(); return }
    if (event.key === 'MediaPause' || event.key === 'MediaStop' || event.keyCode === 19 || event.keyCode === 413) { event.preventDefault(); if (playing) togglePlayback(); return }
    if (event.key === ' ' && event.target.tagName !== 'INPUT' && !document.querySelector('dialog[open]') && !event.repeat) { event.preventDefault(); togglePlayback() }
    if (/^[1-9]$/.test(event.key) && event.target.tagName !== 'INPUT') {
      event.preventDefault()
      const number = Number(event.key)
      if (number <= groups().length) selectScene(groups()[number - 1].selected)
    }
    if (event.key.startsWith('Arrow') && (event.target.tagName !== 'INPUT' || (event.target.type === 'range' && ['ArrowUp', 'ArrowDown'].includes(event.key)))) { event.preventDefault(); moveFocus(event.key) }
    if (event.key === 'Enter' && event.target === document.body) { event.preventDefault(); togglePlayback() }
  })
  fetch('credits.json').then(response => response.json()).then(renderCredits)
  render()
  coreReady = CoreState.load()
  core = await coreReady
  try {
    const saved = localStorage.getItem('aeola.soundState')
    if (saved) core.restore(new TextEncoder().encode(saved))
  } catch { localStorage.removeItem('aeola.soundState') }
  state = core.state()
  render()
  setInterval(updateClock, 1000)
  if (!localStorage.getItem('aeola.benchmarkClass')) {
    setTimeout(async () => {
      try {
        const result = await BufferedAudio.benchmark(core.module)
        const performanceClass = { fine: 0, weak: 1, tooWeak: 2 }[result.classification]
        persist('benchmarkClass', performanceClass)
        if (performanceClass > 0) { weakDeviceNotice = true; render() }
      } catch {}
    }, 100)
  }
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('service-worker.js').catch(() => {})
}
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(visualizerFrame); else if (playing) drawVisualizer() })
start().catch(cause => { error = String(cause); render() })
