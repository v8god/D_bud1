/**
 * Cubism Core 6 exposes drawable render order through _model.getRenderOrders(),
 * while pixi-live2d-display-advanced 1.1.0 reads getDrawableRenderOrders().
 * This bridge forwards the real array without sorting or inventing values.
 */
export function installCubism6RenderOrderBridge(model: unknown): void {
  const live2DModel = model as {
    internalModel?: {
      coreModel?: {
        _model?: {
          getRenderOrders?: () => Int32Array;
          offscreens?: { count?: number };
        };
        getDrawableCount?: () => number;
        getDrawableRenderOrders?: () => Int32Array;
      };
    };
  };

  const coreModel = live2DModel.internalModel?.coreModel;
  const cubism6Model = coreModel?._model;
  if (!coreModel || !cubism6Model) {
    throw new Error("Cubism core model is unavailable");
  }

  const drawableCount = coreModel.getDrawableCount?.() ?? 0;
  const offscreenCount = cubism6Model.offscreens?.count ?? 0;
  const renderOrders = cubism6Model.getRenderOrders?.();

  if (!(renderOrders instanceof Int32Array)) {
    throw new Error("Cubism 6 render-order array is unavailable");
  }
  if (offscreenCount !== 0) {
    throw new Error(`Cubism 6 offscreen layers are unsupported (${offscreenCount} found)`);
  }
  if (renderOrders.length !== drawableCount) {
    throw new Error(
      `Render-order mismatch: ${renderOrders.length} orders for ${drawableCount} drawables`,
    );
  }

  const seen = new Uint8Array(drawableCount);
  for (let drawableIndex = 0; drawableIndex < drawableCount; drawableIndex += 1) {
    const order = renderOrders[drawableIndex];
    if (order < 0 || order >= drawableCount || seen[order] === 1) {
      throw new Error(`Invalid render order ${order} at drawable ${drawableIndex}`);
    }
    seen[order] = 1;
  }

  coreModel.getDrawableRenderOrders = () => renderOrders;
}
