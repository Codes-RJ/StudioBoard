import { useEffect, useRef, useState } from 'react';
import api, { resolveApiUrl } from '../services/api';
import { SERVER_WORKSPACE_ENABLED } from '../config/workspace';

const INITIAL_STATE = {
  snapshot: null,
  status: 'idle',
  error: null,
  lastUpdated: null
};

export const useRealtimeDataset = (datasetId, { enabled = true, intervalMs = 8000 } = {}) => {
  const [state, setState] = useState(INITIAL_STATE);
  const refreshRef = useRef(async () => null);

  useEffect(() => {
    if (!datasetId || !SERVER_WORKSPACE_ENABLED) {
      setState((previousState) => ({
        ...INITIAL_STATE,
        status: 'idle'
      }));
      refreshRef.current = async () => null;
      return undefined;
    }

    if (!enabled) {
      refreshRef.current = async () => {
        try {
          const { data } = await api.get(`/analytics/live/${datasetId}/snapshot`);
          setState({
            snapshot: data,
            status: 'paused',
            error: null,
            lastUpdated: data?.meta?.generatedAt || new Date().toISOString()
          });
          return data;
        } catch (error) {
          setState((previousState) => ({
            ...previousState,
            status: 'error',
            error
          }));
          return null;
        }
      };

      setState((previousState) => ({
        ...previousState,
        status: 'paused'
      }));

      return undefined;
    }

    let isActive = true;
    let pollingTimer = null;
    let eventSource = null;

    const applySnapshot = (snapshot, status) => {
      if (!isActive) {
        return;
      }

      setState({
        snapshot,
        status,
        error: null,
        lastUpdated: snapshot?.meta?.generatedAt || new Date().toISOString()
      });
    };

    const fetchSnapshot = async (status = 'polling') => {
      try {
        const { data } = await api.get(`/analytics/live/${datasetId}/snapshot`);
        applySnapshot(data, status);
        return data;
      } catch (error) {
        if (isActive) {
          setState((previousState) => ({
            ...previousState,
            status: 'error',
            error
          }));
        }
        return null;
      }
    };

    refreshRef.current = () => fetchSnapshot(eventSource ? 'live' : 'polling');

    const startPolling = () => {
      if (pollingTimer) {
        return;
      }

      setState((previousState) => ({
        ...previousState,
        status: previousState.snapshot ? 'polling' : 'connecting'
      }));

      fetchSnapshot('polling');
      pollingTimer = window.setInterval(() => {
        fetchSnapshot('polling');
      }, intervalMs);
    };

    setState((previousState) => ({
      ...previousState,
      status: 'connecting',
      error: null
    }));

    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      startPolling();
    } else {
      eventSource = new window.EventSource(resolveApiUrl(`/analytics/live/${datasetId}/stream`), {
        withCredentials: true
      });

      eventSource.addEventListener('snapshot', (event) => {
        try {
          applySnapshot(JSON.parse(event.data), 'live');
        } catch (error) {
          if (isActive) {
            setState((previousState) => ({
              ...previousState,
              status: 'error',
              error: new Error('The live analytics stream returned an invalid snapshot.', { cause: error })
            }));
          }
          eventSource?.close();
          startPolling();
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        startPolling();
      };
    }

    return () => {
      isActive = false;

      if (eventSource) {
        eventSource.close();
      }

      if (pollingTimer) {
        window.clearInterval(pollingTimer);
      }
    };
  }, [datasetId, enabled, intervalMs]);

  return {
    ...state,
    refresh: () => refreshRef.current()
  };
};

export default useRealtimeDataset;
