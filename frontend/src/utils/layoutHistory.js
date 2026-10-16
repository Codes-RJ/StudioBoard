const cloneLayout = (layout) => {
  if (!layout) return layout;
  return {
    ...layout,
    layout: Array.isArray(layout.layout)
      ? layout.layout.map((item) => ({ ...item }))
      : []
  };
};

const layoutsMatch = (left, right) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.id === right.id &&
    left.name === right.name &&
    JSON.stringify(left.layout || []) === JSON.stringify(right.layout || []);
};

export const createLayoutHistory = (initialLayout, maximumEntries = 50) => {
  let present = cloneLayout(initialLayout);
  let past = [];
  let future = [];

  const snapshot = () => ({
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    present: cloneLayout(present)
  });

  return {
    apply(nextLayout) {
      const next = cloneLayout(nextLayout);
      if (layoutsMatch(present, next)) return snapshot();
      if (present) past = [...past, cloneLayout(present)].slice(-maximumEntries);
      present = next;
      future = [];
      return snapshot();
    },

    replace(nextLayout) {
      present = cloneLayout(nextLayout);
      return snapshot();
    },

    reset(nextLayout) {
      present = cloneLayout(nextLayout);
      past = [];
      future = [];
      return snapshot();
    },

    undo() {
      if (past.length === 0) return snapshot();
      if (present) future = [cloneLayout(present), ...future];
      present = past.at(-1);
      past = past.slice(0, -1);
      return snapshot();
    },

    redo() {
      if (future.length === 0) return snapshot();
      if (present) past = [...past, cloneLayout(present)].slice(-maximumEntries);
      present = future[0];
      future = future.slice(1);
      return snapshot();
    },

    snapshot
  };
};
