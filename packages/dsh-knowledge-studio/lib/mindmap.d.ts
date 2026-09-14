export const MINDMAP_FONT: string
export function escapeXML(value: unknown): string
export function mindmapTree(content: any): {nodes: any[]; roots: any[]; byId: Map<string,any>}
export function layoutMindmap(content: any, options?: {collapsed?: string[]}): {width:number; height:number; nodes:any[]; edges:any[]; rootId:string; total:number}
export function mindmapSVG(content: any, title?: string): string
export function mindmapMarkdown(artifact: any): string
export function mindmapPNGSize(width:number,height:number): {width:number; height:number; scale:number}
