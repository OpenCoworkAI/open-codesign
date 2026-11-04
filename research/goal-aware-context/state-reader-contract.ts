import { z } from 'zod';
import { stateAnswerSchema } from './state-evaluation.js';

const jsonSchema = z.toJSONSchema(stateAnswerSchema);
export const stateReaderContract = {
  id: 'trace-state-reader@3',
  jsonSchema,
  prompt: [
    'Extract current states from frozenMemory only. No archive, tool execution or invented facts. Return only requested stateKeys, one state per key.',
    `Return JSON conforming to this schema: ${JSON.stringify(jsonSchema)}`,
    'stateKeys name questions: approvedColor asks for the user-approved color; diskColor asks for the latest on-disk observation, regardless of approval; r1Preview asks about the specified preview receipt, its historical result and current validity; fontSize asks for the user instruction governing size; nextAction asks for the earliest uncompleted required action; animations asks for the user policy; font asks for the user decision, not a reported file observation.',
    'For local states answer for the active design only, using the latest explicit user design selection in memory. Do not output archived and current versions under duplicate keys. Workspace-global constraints remain global.',
    'kind: intent = user-approved choice or preservation/prohibition, even when phrased as a file property; artifact-fact = observed file content; verification = tool success/failure receipt; obligation = pending required action, not merely an intention.',
    'value: one atomic value, no explanation or combined states. Copy exact literal property values. Use preserve for a preservation instruction, disabled for a prohibition, unresolved for a choice not decided, passed for a successful historical verification. For an obligation report only the immediate required action: tool:path if both are explicit, otherwise a concise source action phrase. Later steps do not replace its prerequisite.',
    'scope: workspaceId must be a nonempty string from memory, never null. If workspace is missing, omit that state rather than invent it. Extract designId, file path, objectId, field and revision; null means not applicable, not a shortcut for a described property. field is the property identifier in the evidence, not an explanatory sentence or a combined key; verification uses its operation name; a next-action obligation uses the requested state key. Do not place a file path in objectId.',
    'A workspace-global rule has designId/file/objectId/revision null but still has its property field. Local rules retain their design/file/object scope. User choices generally have revision null across edits. Observed artifact facts bind to their observed revision; verification binds to the receipt revision, even after it becomes stale. Do not widen a local choice to another design; report that design undecided if evidence says so.',
    'sources: cite minimal original establishing evidence with exact eventId, seq, original authority and source revision. Preserve the original user approval unless explicitly replaced. A stale verification needs both the original receipt and the later observation that invalidates it. Do not add superseded or other-design facts as support for a current choice. Never cite future events.',
    'invalidation.status: active when currently applicable, stale for historical verification invalidated by a newer revision, unresolved for an undecided choice. A formerly passed receipt keeps value passed while its status becomes stale.',
    'invalidation.rules describe future events that would end or replace this state, even while it is active; they are not merely a list of changes that already occurred. Use exactly the relevant set with no duplicates: intent uses explicit-user-change and additionally scope-change when restricted to a design/file/object; workspace-global intent uses explicit-user-change. artifact-fact uses new-observation. verification uses revision-change. obligation uses until-completed and explicit-user-change. No success is implied by a failed or missing receipt.',
  ].join('\n'),
};
