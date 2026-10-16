import { useEffect, useRef, useState } from 'react';
import { loadAssistantArtifact, saveAssistantArtifact, deleteAssistantArtifact } from '../utils/localDatasetStore';

/** Do not overwrite a saved thread while restoration is still in flight. */
export default function useAssistantConversation(key, datasetIds, messages, setMessages) {
  const [readyKey, setReadyKey] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const latestMessages = useRef(messages);
  latestMessages.current = messages;
  const idsKey = JSON.stringify(datasetIds);
  useEffect(() => {
    const current = ++generation.current;
    setReadyKey(''); setError(''); setMessages([]);
    loadAssistantArtifact(key).then((saved) => {
      if (current === generation.current && saved?.messages && !latestMessages.current.length) setMessages(saved.messages);
    }).catch(() => { if (current === generation.current) setError('Conversation storage is unavailable; this thread stays in memory.'); })
      .finally(() => { if (current === generation.current) setReadyKey(key); });
    return () => { generation.current += 1; };
  }, [key]);
  useEffect(() => {
    if (readyKey !== key || !messages.length) return;
    // Bound retained context without affecting source rows or evidence indexes.
    const retained = messages.slice(-40);
    if (JSON.stringify(retained).length > 500_000) { setError('This large thread stays in memory. Clear chat to remove the saved conversation.'); return; }
    const timer = setTimeout(() => {
      saveAssistantArtifact({ id: key, datasetIds: JSON.parse(idsKey), messages: retained })
        .then((saved) => { if (!saved) setError('This conversation stays in memory until every source is saved locally.'); })
        .catch(() => setError('Conversation could not be saved. Export your workspace to protect source data.'));
    }, 150);
    return () => clearTimeout(timer);
  }, [key, readyKey, messages, idsKey]);
  const clear = async () => {
    // Invalidate an outstanding restore before removing its stored thread.
    generation.current += 1; setMessages([]); setReadyKey(key);
    try { await deleteAssistantArtifact(key); setError(''); }
    catch { setError('The saved conversation could not be deleted. Try again.'); }
  };
  return { restored: readyKey === key, storageError: error, clear };
}
