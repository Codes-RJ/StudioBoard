const plotlyRenderers = new WeakMap();

export const registerPlotlyRenderer = (element, renderer) => {
  plotlyRenderers.set(element, renderer);
};

export const unregisterPlotlyRenderer = (element) => {
  plotlyRenderers.delete(element);
};

export const capturePlotlyImage = async (element) => {
  const renderer = plotlyRenderers.get(element);
  if (!renderer || !element.data) return null;

  try {
    const image = await renderer.toImage(element, {
      format: 'png',
      width: Math.min(1200, Math.max(400, Math.round(element.clientWidth || 0))),
      height: Math.min(800, Math.max(300, Math.round(element.clientHeight || 0))),
      scale: 1
    });
    return typeof image === 'string' && image.startsWith('data:image/png;base64,') ? image : null;
  } catch {
    return null;
  }
};
