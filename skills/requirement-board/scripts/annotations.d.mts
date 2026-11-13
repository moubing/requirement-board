import type { AnnotationNodeRegistry, AnnotationNodeDom } from './annotation-node-capabilities.mjs'
export * from './annotation-node-capabilities.mjs'
export interface AnnotationBlock { blockId: string; topLevelId: string; blockType: string; text: string; section: string; order: number }
export interface AnnotationSegment { blockId: string; topLevelId: string; blockType: string; start: number; end: number; quote: string; prefix: string; suffix: string; blockText: string }
export interface CellRange { row: number; column: number; rowspan: number; colspan: number }
interface ObjectTargetBase { blockId: string; topLevelId: string; signature: string; summary: string }
export type LegacyObjectAnnotationTarget = ObjectTargetBase & ({ type: 'image'; src: string } | { type: 'table' } | { type: 'cell'; tableId: string; nodeType: 'tableCell' | 'tableHeader'; range: CellRange })
export type NodeAnnotationTarget = ObjectTargetBase & { type: 'node'; nodeType: string; version: number; context?: Record<string, unknown> }
export type ObjectAnnotationTarget = LegacyObjectAnnotationTarget | NodeAnnotationTarget
export interface AiAnnotation { id: string; quote: string; comment: string; section: string; segments: AnnotationSegment[]; target?: { type: 'text' } | ObjectAnnotationTarget }
export interface AnnotationResolution { id: string; status: 'exact' | 'moved' | 'unresolved'; reason: string; segments: AnnotationSegment[]; target?: ObjectAnnotationTarget }
export interface AnnotationCompletion { id: string; fingerprint: string }
export interface AnnotationRequest { format: 'rb-annotations/v1' | 'rb-annotations/v2'; requirements?: typeof ANNOTATION_REQUIREMENTS; source: 'shared-draft'; document: { id: string; key: string; title: string; origin: string; url: string }; contentToken: string; createdAt: string; overall: string; annotations: AiAnnotation[]; completion?: AnnotationCompletion[] }
export function annotationFingerprint(note: AiAnnotation, overall: string, format?: AnnotationRequest['format']): Promise<string>
export const ANNOTATION_FORMAT: 'rb-annotations/v2'
export const LEGACY_ANNOTATION_FORMAT: 'rb-annotations/v1'
export const ANNOTATION_REQUIREMENTS: { schemaVersion: 3; capabilitiesVersion: number; capabilities: string[]; targetTypes: string[] }
export const LEGACY_OBJECT_REQUIREMENTS: typeof ANNOTATION_REQUIREMENTS
export function captureObjectTarget(document: unknown, type: LegacyObjectAnnotationTarget['type'], blockId: string): LegacyObjectAnnotationTarget
export function captureNodeTarget(document: unknown, blockId: string, registry?: AnnotationNodeRegistry): NodeAnnotationTarget
export function nodeContentSignature(node: unknown, registry?: AnnotationNodeRegistry): string
export function objectContentSignature(node: unknown): string
export function objectTargetLabel(target: ObjectAnnotationTarget): string
export function objectTargetNodeType(target: ObjectAnnotationTarget): string
export function objectTargetPresentation(target: ObjectAnnotationTarget, nested?: boolean, registry?: AnnotationNodeRegistry): { label: string; title: string; menu: string; description?: string; thumbnail?: string; dom: AnnotationNodeDom }
export function tableCellRanges(table: unknown): { node: unknown; range: CellRange }[]
export const MAX_ANNOTATIONS: number
export const MAX_REQUEST_BYTES: number
export function extractAnnotationBlocks(document: unknown, registry?: AnnotationNodeRegistry): AnnotationBlock[]
export function anchorSegment(block: AnnotationBlock, start: number, end: number): AnnotationSegment
export function validateAnnotation(note: unknown, registry?: AnnotationNodeRegistry): AiAnnotation
export function resolveAnnotation(note: AiAnnotation, document: unknown, registry?: AnnotationNodeRegistry): AnnotationResolution
export function validateAnnotationRequest(request: unknown, registry?: AnnotationNodeRegistry): AnnotationRequest
export function formatAnnotationRequest(request: AnnotationRequest, registry?: AnnotationNodeRegistry): string
export function parseAnnotationRequest(text: string, registry?: AnnotationNodeRegistry): AnnotationRequest
export function resolveAnnotationRequest(request: AnnotationRequest, snapshot: unknown, origin: string, registry?: AnnotationNodeRegistry): { ready: boolean; sourceChanged: boolean; annotations: (AnnotationResolution & { comment: string; quote: string })[]; topLevelIds: string[]; overall: string; requirementId: string; contentToken: string; format: string }
export function assertAnnotationCapabilities(request: AnnotationRequest, schema: unknown, registry?: AnnotationNodeRegistry): void
