export interface DebugOperationParameter {
  name: string;
  type: string;
  required: boolean;
  definition?: string;
}

export interface DebugOperation {
  name: string;
  kind: 'call' | 'event';
  channel: string;
  domain: string;
  mode: 'local' | 'model' | 'live' | 'unsupported';
  parameters: readonly DebugOperationParameter[];
  reason?: string;
}

export type DebugOperationEntry = DebugOperation;

function operation(
  name: string,
  kind: DebugOperation['kind'],
  channel: string,
  domain: string,
  mode: DebugOperation['mode'],
  parameters: readonly DebugOperationParameter[],
  reason?: string,
): DebugOperation {
  return { name, kind, channel, domain, mode, parameters, ...(reason ? { reason } : {}) };
}

// Explicit core workflow surface. Add operations only when a concrete workflow needs them.
export const DEBUG_OPERATIONS: readonly DebugOperation[] = [
  operation(
    'generate',
    'call',
    'codesign:v1:generate',
    'generation',
    'model',
    [
      {
        name: 'payload',
        type: 'object',
        required: true,
        definition:
          '{ prompt: string; history: ChatMessage[]; model: ModelRef; baseUrl?: string; referenceUrl?: string; attachments: LocalInputFile[]; generationId: string; designId: string; previousSource?: string; }',
      },
    ],
    'Runs a model-backed generation action; requires fixture or live model mode.',
  ),
  operation('cancelGeneration', 'call', 'codesign:v1:cancel-generation', 'generation', 'local', [
    { name: 'generationId', type: 'string', required: true },
  ]),
  operation(
    'export',
    'call',
    'codesign:export',
    'export',
    'local',
    [{ name: 'payload', type: 'object', required: true, definition: 'ExportInvokePayload' }],
    'Consumes the next isolated export destination; otherwise cancels the save.',
  ),
  operation(
    'settings.listProviders',
    'call',
    'settings:v1:list-providers',
    'settings',
    'local',
    [],
  ),
  operation('files.read', 'call', 'codesign:files:v1:read', 'files', 'local', [
    { name: 'designId', type: 'string', required: true },
    { name: 'path', type: 'string', required: true },
  ]),
  operation('files.write', 'call', 'codesign:files:v1:write', 'files', 'local', [
    { name: 'designId', type: 'string', required: true },
    { name: 'path', type: 'string', required: true },
    { name: 'content', type: 'string', required: true },
    { name: 'options', type: 'object', required: false, definition: '{ expectedContent: string }' },
  ]),
  operation('snapshots.createDesign', 'call', 'snapshots:v1:create-design', 'snapshots', 'local', [
    { name: 'name', type: 'string', required: true },
    { name: 'workspacePath', type: 'string | null', required: false },
    { name: 'demoInputId', type: 'string', required: false },
  ]),
  operation('chat.onAgentEvent', 'event', 'agent:event:v1', 'chat', 'local', []),
  operation('ask.pending', 'call', 'ask:list-pending', 'ask', 'local', []),
  operation('ask.resolve', 'call', 'ask:resolve', 'ask', 'local', [
    { name: 'requestId', type: 'string', required: true },
    { name: 'result', type: 'object', required: true, definition: 'AskResult' },
  ]),
  operation(
    'test.exportDestination',
    'call',
    'codesign:debug:operation',
    'test',
    'local',
    [{ name: 'path', type: 'string', required: true }],
    'Sets the next export save destination inside the temporary instance.',
  ),
];

const operationsByName = new Map<string, DebugOperation>(
  DEBUG_OPERATIONS.map((item) => [item.name, item]),
);

export function findDebugOperation(name: string): DebugOperation | undefined {
  return operationsByName.get(name);
}
