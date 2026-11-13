export interface AnnotationNode { type: string; attrs?: Record<string, any>; text?: string; content?: AnnotationNode[] }
export interface AnnotationNodeDom { boundsSelector?: string; excludeSelector?: string; touchSurfaceSelector?: string }
export interface AnnotationNodeObject {
  version?: number
  context?: (node: AnnotationNode, ancestors: AnnotationNode[], cache: Map<unknown, any>) => Record<string, any>
  validateContext?: (context: any) => boolean
  sameIdentity?: (before: any, after: any) => boolean
  identityError?: string
  location?: (context: any) => string
  menu?: (target: unknown, nested: boolean) => string
  thumbnail?: (context: any) => string
  dom?: AnnotationNodeDom
}
export interface AnnotationNodeDefinition {
  label: string; text?: 'block' | 'children'; object?: boolean | AnnotationNodeObject
  ignoredAttrs?: string[]; defaultAttrs?: Record<string, unknown>; summaryAttrs?: string[]
}
export type AnnotationNodeRegistry = Readonly<Record<string, Omit<AnnotationNodeDefinition, 'object'> & { object?: AnnotationNodeObject & { version: number } }>>
export function createAnnotationNodeRegistry(definitions: Record<string, AnnotationNodeDefinition>): AnnotationNodeRegistry
export const annotationNodeCapabilities: AnnotationNodeRegistry
export function nodeAnnotationCapability(nodeType: string, registry?: AnnotationNodeRegistry): AnnotationNodeRegistry[string] | undefined
export function annotationNodeManifest(registry?: AnnotationNodeRegistry): Record<string, { version: number; label: string }>
export function tableCellRanges(table: AnnotationNode): { node: AnnotationNode; range: { row: number; column: number; rowspan: number; colspan: number } }[]
