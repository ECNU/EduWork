export interface OfficePreviewState { page:number; mode:'fit-page'|'fit-width'|'manual'; scale:number }
export interface OfficePreviewDescription {
  schemaVersion:1; kind:'slides'|'document'; sourceHash:string; rendererVersion:string; fontFingerprint:string; cacheKey:string;
  pageCount:number|null; pageWidth:number|null; pageHeight:number|null; warnings:Array<{code:string;message:string}>;
}
export interface OfficePreview { html:string; bytes?:number; description?:OfficePreviewDescription }
export interface OfficePreviewOptions { preview:OfficePreview; title?:string; onExpand?:()=>void; onStateChange?:(state:OfficePreviewState)=>void; onError?:(error:Error)=>void }
export function mountOfficePreview(container:HTMLElement,options:OfficePreviewOptions):{update(options:Partial<OfficePreviewOptions>):void;getState():OfficePreviewState|null;destroy():void};
