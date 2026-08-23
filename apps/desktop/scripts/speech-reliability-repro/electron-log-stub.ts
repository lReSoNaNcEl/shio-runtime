const noop = (): void => undefined

export default {
  debug: noop,
  error: noop,
  info: noop,
  warn: noop,
  initialize: noop,
  transports: {
    file: {
      resolvePathFn: noop,
      maxSize: 0,
      level: false as false | string,
      format: '',
    },
    console: {
      level: false as false | string,
    },
  },
}
