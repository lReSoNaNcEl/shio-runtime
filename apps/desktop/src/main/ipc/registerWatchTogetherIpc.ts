import { type BrowserWindow, desktopCapturer, ipcMain } from 'electron'
import { z } from 'zod'

import type { WatchTogetherService } from '../watch-together/WatchTogetherService'
import type { IpcAuthorization } from './IpcAuthorization'

export function registerWatchTogetherIpc(
  win: BrowserWindow,
  watch: WatchTogetherService,
  auth: IpcAuthorization,
): () => void {
  const id = z.tuple([z.string().uuid()])
  const bytes = (min: number, max: number) =>
    z.instanceof(ArrayBuffer).refine((b) => b.byteLength >= min && b.byteLength <= max)
  const moment = z.tuple([
    z
      .object({
        sessionId: z.string().uuid(),
        endedAt: z.number().int().positive(),
        frames: bytes(100, 300000),
        pcm: bytes(0, 192000).refine(
          (b) => b.byteLength === 0 || (b.byteLength >= 512 && b.byteLength % 2 === 0),
        ),
        playbackTranscript: z.string().max(1000),
      })
      .strict(),
  ])
  const wc = win.webContents
  const session = wc.session
  session.setDisplayMediaRequestHandler(async (request, cb) => {
    if (
      process.platform !== 'win32' ||
      wc.isDestroyed() ||
      request.frame !== wc.mainFrame ||
      !request.userGesture ||
      !request.videoRequested ||
      !request.audioRequested
    )
      return cb({})
    const grant = watch.takeGrant()
    if (!grant) return cb({})
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 0, height: 0 },
      })
      const video = sources.find((s) => s.id === grant.sourceId)
      if (!video || wc.isDestroyed() || request.frame !== wc.mainFrame || !watch.current(grant.id))
        return cb({})
      cb({ video, audio: 'loopback' })
    } catch {
      cb({})
    }
  })
  ipcMain.handle(
    'watch:start',
    auth.handlePayload(
      'watch:start',
      z.tuple([z.string().regex(/^(screen|window):\d+:\d+$/)]),
      (event, source) => {
        if (process.platform !== 'win32' || event.senderFrame !== wc.mainFrame)
          throw new Error('WATCH_UNAVAILABLE')
        return watch.start(source)
      },
    ),
  )
  ipcMain.handle(
    'watch:stop',
    auth.handlePayload('watch:stop', id, (_event, id) => watch.stop(id)),
  )
  ipcMain.handle(
    'watch:yield',
    auth.handlePayload('watch:yield', id, (_event, id) => watch.yield(id)),
  )
  ipcMain.handle(
    'watch:observe',
    auth.handlePayload('watch:observe', moment, (_event, input) => watch.observe(input)),
  )
  ipcMain.handle(
    'watch:classify-speech',
    auth.handlePayload(
      'watch:classify-speech',
      z.tuple([z.string().uuid(), z.string().trim().min(1).max(800), z.boolean()]),
      (_event, sessionId, text, recentAddress) =>
        watch.classifySpeech(sessionId, text, recentAddress),
    ),
  )
  ipcMain.handle(
    'watch:finish-comment',
    auth.handlePayload(
      'watch:finish-comment',
      z.tuple([z.string().uuid(), z.string().min(1).max(100), z.boolean()]),
      (_event, sessionId, turnId, played) => watch.finishComment(sessionId, turnId, played),
    ),
  )
  ipcMain.handle(
    'watch:prepare-turn',
    auth.handlePayload(
      'watch:prepare-turn',
      z.tuple([
        z.string().uuid(),
        z.string().min(1).max(100),
        z.boolean(),
        bytes(100, 300000).optional(),
        z.string().max(1000).optional(),
      ]),
      (_event, sessionId, turnId, fromMicrophone, frame, transcript) =>
        watch.prepareTurn(sessionId, turnId, fromMicrophone, frame, transcript),
    ),
  )
  const stop = () => watch.stop()
  const navigate = (_event: unknown, _url: string, inPlace: boolean, isMain: boolean) => {
    if (isMain && !inPlace) stop()
  }
  wc.on('did-start-navigation', navigate)
  wc.on('render-process-gone', stop)
  wc.once('destroyed', stop)
  return () => {
    stop()
    wc.off('did-start-navigation', navigate)
    wc.off('render-process-gone', stop)
    wc.off('destroyed', stop)
    session.setDisplayMediaRequestHandler(null)
    for (const channel of [
      'watch:start',
      'watch:observe',
      'watch:classify-speech',
      'watch:finish-comment',
      'watch:prepare-turn',
      'watch:stop',
      'watch:yield',
    ])
      ipcMain.removeHandler(channel)
  }
}
