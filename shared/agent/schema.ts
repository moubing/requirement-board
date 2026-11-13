import { z } from 'zod'
import { BLOCK_NODE_TYPES } from '../editor/document'
import { richTextProseMirrorSchema } from '../editor/validation'
import { DOCUMENT_SCHEMA_VERSION, suggestionInputSchema, createSuggestionInputSchema } from './suggestions'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_WORKFLOWS } from '../documents/workflow'
import { annotationNodeManifest } from './annotations'
import { requirementPageQuerySchema } from '../requirements/query'
import { addRelatedDocumentsSchema } from '../requirements/relations'
import { calloutTones, calloutToneDetails } from '../editor/callout'
import { CODE_BLOCK_TITLE_MAX_LENGTH } from '../editor/code-block'
import { DOCUMENT_NODE_CAPABILITIES } from '../editor/capabilities'

/** Reflect the installed document schema; keep business constraints next to its actual validator. */
export function agentDocumentSchema() {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    capabilitiesVersion: 13,
    annotationFormats: ['rb-annotations/v1', 'rb-annotations/v2'],
    annotationTargetTypes: ['text', 'node', 'image', 'table', 'cell'],
    annotationNodes: annotationNodeManifest(),
    documentTypes: DOCUMENT_TYPE_LABELS,
    workflows: DOCUMENT_WORKFLOWS,
    capabilities: ['read', 'search', 'paginated_search', 'document_relations', 'properties', 'history', 'create', 'save_revision', 'direct_execution', 'image_upload', 'image_read', 'conditional_read', 'diff', 'text_history', 'annotation_completion', 'node_annotations', 'callout_tones', ...DOCUMENT_NODE_CAPABILITIES],
    documentSearch: {
      query: z.toJSONSchema(requirementPageQuerySchema, { io: 'input' }),
      defaults: requirementPageQuerySchema.parse({}),
      response: ['items', 'total', 'page', 'pageSize', 'asOf'],
      legacy: 'Requests with only q (or no query parameters) retain the legacy array, limited to 100 items. Send page=1&pageSize=20 for the paginated protocol. Both use the same query service.',
    },
    relatedDocuments: {
      read: 'GET requirements/:id/related',
      add: 'POST requirements/:id/related',
      remove: 'DELETE requirements/:id/related/:relatedId',
      input: z.toJSONSchema(addRelatedDocumentsSchema, { io: 'input' }),
    },
    format: 'tiptap-json',
    operations: z.toJSONSchema(suggestionInputSchema),
    create: z.toJSONSchema(createSuggestionInputSchema, { io: 'input' }),
    nodes: Object.fromEntries(Object.entries(richTextProseMirrorSchema.nodes).map(([name, node]) => [name, {
      content: node.spec.content,
      group: node.spec.group,
      marks: node.spec.marks,
      attrs: name === 'callout' ? { ...node.spec.attrs, tone: { default: 'note', enum: calloutTones } } : node.spec.attrs,
    }])),
    marks: Object.fromEntries(Object.entries(richTextProseMirrorSchema.marks).map(([name, mark]) => [name, { attrs: mark.spec.attrs }])),
    rules: {
      root: 'doc',
      trailingParagraph: 'A document ending with a non-paragraph block receives one empty paragraph before execution and version saving. Existing final paragraphs (including text) and extra empty paragraphs are preserved. New block IDs are assigned by the server.',
      blockIdNodes: BLOCK_NODE_TYPES,
      headingLevels: [1, 2, 3],
      details: 'details contains exactly detailsSummary (text*) followed by detailsContent (block+). details and detailsSummary have stable diffId values; preserve descendant IDs. Open/closed is local view state: open and hidden attributes are rejected and must never be written to JSON/Yjs. Plain text includes summary and all content. Replace the containing top-level block to edit nested content. Whole-node annotations target details; text annotations use summary or descendant text block IDs.',
      taskLists: 'taskList contains taskItem+; taskItem starts with paragraph and may contain further blocks, including nested lists. checked is a boolean (omitted means false), belongs to the document and participates in versions. Preserve list, item and descendant diffId values when editing; replace the containing top-level block. Plain text uses [x] / [ ] markers, Markdown uses GFM - [x] / - [ ]. Text annotations target the paragraphs inside the items.',
      codeBlocks: {
        titleMaxLength: CODE_BLOCK_TITLE_MAX_LENGTH,
        title: 'Optional single-line title attribute, string or null; control characters are rejected. Omit it or use null for an unnamed code block. Preserve the title when editing code. The title is metadata, not part of the code text.',
      },
      callouts: {
        tones: calloutToneDetails,
        content: 'inline* directly, without a paragraph wrapper. tone defaults to note when omitted; only note, tip, warning, danger are accepted. Unknown values (including info/success) are rejected. Labels, icons and placeholders are presentation only; never insert them into content. Preserve diffId and content when changing tone. Tone changes invalidate whole-node annotations.',
      },
      operations: 'Only top-level blocks are operation targets. Replace a containing list or table to edit its children.',
      blockIds: 'Preserve existing diffId values within a replaced block. Omit diffId on every new block; the server assigns it. Never copy IDs from another block.',
      images: 'An image requires imageCaption content and align left/center/right. Dimensions, when provided, are positive numbers. Do not use data: or blob: sources. Existing /uploads/ assets must belong to this project.',
      upload: 'POST assets/upload with multipart file and uploadId, plus requirementId OR createRequestId. PNG/JPEG/GIF/WebP, maximum 5 MiB. Use the returned image node; staged create images belong to the current user, project and create request and expire after 24 hours before submission. Retry identical uploads with the same uploadId.',
      imageRead: 'GET requirements/:id/images/:diffId with optional snapshotId. PAT authorization checks the document and actual current-draft or active-snapshot reference. Hosted PNG/JPEG/GIF/WebP only, maximum 5 MiB, no external fetching. Animated GIF/WebP viewing guarantees the first frame only. Read only when the task needs visual evidence; downloading alone is not visual verification.',
      reading: 'read and snapshot accept ifContentToken. On notModified=true, reuse cached title/contentJson, but always use the newly returned snapshot ID, lock and properties. status omits document content. Tokens include title, body, block IDs and schema; properties and version metadata are separate.',
      search: 'Use paginated_search with explicit page/pageSize (defaults 1/20, pageSize 1–100). Reject unknown or repeated scalar parameters, invalid sorts and unsafe offsets. Keep site, filters and sorting unchanged across pages. me is the authenticated PAT user. Filters: q, documentType, statusId, assignee (me/unassigned/member ID), reporter (me/member ID), stale=1 (queued/doing/testing with no body edit, status change or revision for more than 14/3/3 days; title, assignee and priority changes do not count), excludeId. Each page and total share a read-only snapshot at asOf; separate pages are not a fixed snapshot. For all results continue until no next page, deduplicate by ID and report partial failures and concurrent changes.',
      relations: 'Use document_relations only for explicitly requested targets. All references must belong to the same site and authorized project. Add 1–100 inputs before deduplication; remove one target. Writes are atomic and idempotent, preserve other relations, body, Yjs and revisions, and reject any active AI lock on either side, including the same PAT. Finish and recover body operations before linking. For an unclear relation response read current relations before retrying the still-valid intent; do not automatically replay against an opposite concurrent change.',
      diff: 'GET requirements/:id/diff compares latest to draft by default; from/to accept vN, revision IDs, latest or draft. stat=true returns counts; paginate with nextOffset and comparisonToken. GET show?version=vN and revisions provide snapshots and save metadata.',
      history: 'GET requirements/:id/history?text=... supports at, block and Unicode start offset. Ambiguous matches require selection. Reports version-level evidence and node participants, NOT exact sentence authors or input timestamps. Each entry explains its evidence and identifies comparedTo. tracking_lost means found here but unable to reliably trace earlier; introduced with exact means the earliest available record, not proven creation. At most 200 adjacent revisions; history_boundary is not introduction.',
      validation: 'Unknown nodes, marks and attributes are rejected. Content expressions and all final-document constraints are checked by the server.',
      execution: 'POST operations executes immediately. There is no review workflow. Validation is read-only. Update the shared draft by default; include saveRevision only when the user explicitly requests a formal version. Creation initializes the complete document and v1.',
      annotations: 'Export rb-annotations/v2 with text ranges or generic node targets. Check nodeType/version against annotationNodes; callout, image, table and cells use the same pipeline. Callout contains inline text directly; tone is meaningful content. Keep legacy v1 text and v2 image/table/cell targets unchanged, including their copied fingerprints. Resolve ALL targets against the latest schema-3 locked snapshot. Cell context binds tableId and merge spans, not display coordinates. Read complete nodes from the snapshot, preserve untouched JSON and combine edits within each top-level block. Fingerprints describe copied targets and requests, never post-edit targets. Only fully completed entries are acknowledged; they expire after acknowledgement or 7 days.',
      properties: 'Use meta to resolve status codes and member IDs. workflows lists the initial state and available states of each type; any state of the same type can move to any other (including straight to done and reopening), and a state of another type is rejected with 409. New requirements, defects and todos start in queued; instructions start in draft. All document types accept multiple assigneeIds. Send the complete assignment list; an empty array clears it. Only assigneeIds is accepted for assignment updates. State, assignees and priority are independent of content revisions. Every changed property is logged separately. A changed target property or latest revision invalidates its pending action.',
      locking: 'read/search/history do not lock. snapshot exclusively locks the current shared draft for 30 minutes. Validation and new update submissions require its active lock. Successful execution releases the lock. After a lost response retry the identical request; do not create a second request. Explicit release cancels unfinished operations. A newer active lock blocks old retries.',
    },
    examples: {
      paragraph: { type: 'paragraph', content: [{ type: 'text', text: '新增段落' }] },
      details: { type: 'details', content: [{ type: 'detailsSummary', content: [{ type: 'text', text: '补充说明' }] }, { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: '展开后查看的内容' }] }] }] },
      heading: { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '验收标准' }] },
      callout: { type: 'callout', attrs: { tone: 'warning' }, content: [{ type: 'text', text: '上线前确认依赖已就绪。' }] },
      bold: { type: 'text', text: '重点', marks: [{ type: 'bold' }] },
      taskList: { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '完成验收' }] }] }] },
    },
  }
}
