import { useCallback, useEffect, useRef, useState } from 'react';

export default function useDatasetSelection({ initialDataset, loadLocalDatasetRecord, retainLocalDatasetRecord }) {
  const [selectedDataset, publishSelectedDataset] = useState(() => initialDataset);
  const selectedDatasetRef = useRef(selectedDataset);
  const selectionAbortRef = useRef(null);
  const selectionVersionRef = useRef(0);
  const [datasetLoadState, setDatasetLoadState] = useState(null);
  const setSelectedDataset = useCallback((update) => {
    const current = selectedDatasetRef.current;
    const candidate = typeof update === 'function' ? update(current) : update;
    if (candidate === current && typeof update === 'function') return;
    selectionAbortRef.current?.abort(); selectionAbortRef.current = null;
    const version = ++selectionVersionRef.current;
    const publish = (source) => {
      if (selectionVersionRef.current !== version) return;
      selectedDatasetRef.current = source;
      publishSelectedDataset(source);
      retainLocalDatasetRecord(source?.isLocal ? source : null);
      setDatasetLoadState(null);
    };
    if (!candidate?.metadataOnly) { publish(candidate); return; }
    setDatasetLoadState({ id: candidate.id, name: candidate.name, status: 'loading' });
    const controller = new AbortController(); selectionAbortRef.current = controller;
    void loadLocalDatasetRecord(candidate.id, { workingOnly: true, signal: controller.signal }).then(publish).catch((error) => {
      if (selectionVersionRef.current === version) {
        setDatasetLoadState({ id: candidate.id, name: candidate.name, status: 'error', error: error.message });
      }
    });
  }, [loadLocalDatasetRecord, retainLocalDatasetRecord]);
  useEffect(() => () => { selectionVersionRef.current += 1; selectionAbortRef.current?.abort(); }, []);
  return { selectedDataset, selectedDatasetRef, setSelectedDataset, datasetLoadState };
}
