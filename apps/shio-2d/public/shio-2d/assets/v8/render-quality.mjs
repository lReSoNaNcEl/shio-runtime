// Pixel dimensions are independent of model coordinates. Changing quality must
// never scale one model axis or change the camera's aspect ratio.
const UHD_LONG_EDGE = 3840;
export const RENDER_QUALITIES = Object.freeze(['auto', '4k']);
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

/** Return a bounded drawing-buffer size while preserving the CSS aspect ratio. */
export function resolveRenderSize({
  width, height, quality = '4k', devicePixelRatio = 1,
  maxDimension = 8192, maxPixels = UHD_LONG_EDGE * UHD_LONG_EDGE
} = {}) {
  if (!RENDER_QUALITIES.includes(quality)) throw new RangeError('Unknown render quality');
  const cssWidth = positive(width, 1), cssHeight = positive(height, 1);
  const limit = Math.max(1, Math.floor(positive(maxDimension, 8192)));
  const budget = Math.max(1, Math.floor(positive(maxPixels, UHD_LONG_EDGE * UHD_LONG_EDGE)));
  let scale = quality === '4k'
    ? UHD_LONG_EDGE / Math.max(cssWidth, cssHeight)
    : positive(devicePixelRatio, 1);
  scale = Math.min(scale, limit / cssWidth, limit / cssHeight, Math.sqrt(budget / (cssWidth * cssHeight)));
  const pixelWidth = Math.max(1, Math.floor(cssWidth * scale + 1e-9));
  const pixelHeight = Math.max(1, Math.floor(cssHeight * scale + 1e-9));
  return Object.freeze({
    width: pixelWidth, height: pixelHeight, scale,
    quality, cssWidth, cssHeight,
    limited: Math.max(pixelWidth, pixelHeight) < UHD_LONG_EDGE && quality === '4k'
  });
}

/** The camera is expanded around its center; it is never stretched or cropped. */
export function fitCameraToAspect(camera, width, height) {
  if (!Array.isArray(camera) || camera.length !== 4 ||
      !camera.every(Number.isFinite) || camera[2] <= 0 || camera[3] <= 0) {
    throw new TypeError('A finite camera rectangle is required');
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Output dimensions must be positive');
  }
  const [x, y, sourceWidth, sourceHeight] = camera;
  const aspect = width / height, sourceAspect = sourceWidth / sourceHeight;
  const worldWidth = sourceAspect < aspect ? sourceHeight * aspect : sourceWidth;
  const worldHeight = sourceAspect < aspect ? sourceHeight : sourceWidth / aspect;
  return [
    x + (sourceWidth - worldWidth) / 2,
    y + (sourceHeight - worldHeight) / 2,
    worldWidth, worldHeight
  ];
}

export function fourKOutputSize(orientation = 'landscape') {
  if (orientation === 'landscape') return Object.freeze({width: 3840, height: 2160});
  if (orientation === 'portrait') return Object.freeze({width: 2160, height: 3840});
  throw new RangeError('Use landscape or portrait');
}

/**
 * Export an existing renderer without constructing a second WebGL context.
 * draw(camera) must synchronously render one frame. The original canvas and
 * camera are restored even when encoding fails.
 */
export async function exportFourK({
  canvas, camera, draw, orientation = 'portrait', type = 'image/png'
}) {
  if (!canvas || typeof canvas.toBlob !== 'function' || typeof draw !== 'function') {
    throw new TypeError('A canvas and synchronous render callback are required');
  }
  const size = fourKOutputSize(orientation);
  const original = {width: canvas.width, height: canvas.height};
  const camera4k = fitCameraToAspect(camera, size.width, size.height);
  try {
    canvas.width = size.width; canvas.height = size.height;
    draw(camera4k);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('4K image encoding failed')), type
    ));
  } finally {
    canvas.width = original.width; canvas.height = original.height;
    draw(camera);
  }
}

