import { retrieveEvidence } from './evidence';
import { retrieveGraphNeighborhood } from './graph';
import { runSavedGraph } from './savedGraph';
import { calculateDatasetPayload } from './savedAnalysis';
import { createSavedSemanticPager } from './savedSemantic';
import { runSavedEvidence } from './savedEvidence';
import { readEntityPage } from './entities';
import { buildSemanticPage, rankSemanticArtifact, mergeSemanticHits } from './semantic';
import { scanAssistantArtifacts } from '../localDatasetStore';
import { loadWorkerDataset } from '../datasetWorkerReader';
import { decodeDatasetPayload } from '../datasetWorkerPayload';
let semanticSource; let semanticPager;
self.onmessage = async ({ data: { id, operation, payload: encoded } }) => {
  try {
    if (operation === 'entity-next') { self.postMessage({ id, result: await readEntityPage(encoded.dataset, encoded.cursor) }); return; }
    if (operation === 'graph' || operation === 'graph-calculate') {
      const result = await runSavedGraph(operation, encoded, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    if (operation === 'index' || operation === 'retrieve-source') {
      const result = await runSavedEvidence(operation, encoded, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    if (operation === 'calculate') {
      const result = await calculateDatasetPayload(encoded.dataset, encoded.options, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    if (operation === 'semantic-init') {
      semanticPager = encoded.dataset?.kind === 'local-dataset-reference' ? createSavedSemanticPager(encoded.dataset) : undefined;
      semanticSource = semanticPager ? undefined : encoded.dataset;
      self.postMessage({ id, result: { ready: true } }); return;
    }
    const payload = await decodeDatasetPayload(encoded, loadWorkerDataset);
    const operations = {
      retrieve: () => retrieveEvidence(payload.index, payload.query, payload.options),
      neighborhood: () => retrieveGraphNeighborhood(payload.graph, payload.options),
      'semantic-next': () => semanticPager ? semanticPager.next(payload.cursor, payload.filters, payload.limit) : buildSemanticPage(semanticSource, payload.cursor, payload.filters, payload.limit),
      'semantic-retrieve': async () => {
        let hits = [];
        await scanAssistantArtifacts(`${payload.key}:chunk:`, (artifact) => {
          if (artifact.revision === payload.revision) hits = mergeSemanticHits(hits, rankSemanticArtifact(artifact, payload.query, payload.options), payload.options.limit);
        }); return { hits };
      }
    };
    if (!Object.hasOwn(operations, operation)) throw new Error('Unsupported analysis operation.');
    self.postMessage({ id, result: await operations[operation]() });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
