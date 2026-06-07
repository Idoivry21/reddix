const { mkdtemp } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Import the createStorage function
const { createStorage } = require('./server/storage');

async function testConcurrentSaveFlow() {
  const dir = await mkdtemp(path.join(tmpdir(), 'reddix-test-'));
  const storage = createStorage({ baseDir: dir });
  
  const flowId = 'test-flow';
  
  const flow1 = {
    schemaVersion: 1,
    id: flowId,
    name: 'Flow Version 1',
    nodes: [{ id: 'n1' }],
    edges: [],
    nodePositions: {},
    blockSettings: {},
    schedule: { enabled: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  
  const flow2 = {
    schemaVersion: 1,
    id: flowId,
    name: 'Flow Version 2',
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    edges: [],
    nodePositions: {},
    blockSettings: {},
    schedule: { enabled: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z'
  };
  
  // Concurrent saves
  await Promise.all([
    storage.saveFlow(flow1),
    storage.saveFlow(flow2)
  ]);
  
  const saved = await storage.getFlow(flowId);
  console.log('Saved flow:', JSON.stringify(saved, null, 2));
  console.log('Name:', saved?.name);
  console.log('Nodes length:', saved?.nodes.length);
}

testConcurrentSaveFlow().catch(console.error);
