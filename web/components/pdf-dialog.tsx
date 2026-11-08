'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { CV } from '../lib/api';
import { Dialog } from './dialog';

// Keep one page in memory and stay below mobile Safari's canvas limits, even
// for a very large page, a high device pixel ratio or a zoomed view.
const MAX_CANVAS_PIXELS = 4_000_000;
const MAX_CANVAS_SIDE = 4096;

export function PDFDialog({
  id,
  cv,
  onClose,
  onBack,
}: {
  id: string;
  cv?: CV;
  onClose: () => void;
  onBack?: () => void;
}) {
  const url = '/api/v1/cvs/' + encodeURIComponent(id) + '/pdf';
  const containerRef = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDocument, setPDFDocument] = useState<PDFDocumentProxy | null>(null),
    [pageNumber, setPageNumber] = useState(1),
    [zoom, setZoom] = useState(1),
    [containerWidth, setContainerWidth] = useState(0),
    [loading, setLoading] = useState(true),
    [paintedRenderKey, setPaintedRenderKey] = useState(''),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const renderKey = `${url}:${attempt}:${pageNumber}:${zoom}:${containerWidth}`;
  // A new page/zoom must hide the previous pixels in the same React commit,
  // before the asynchronous render effect runs.
  const rendering = !!pdfDocument && paintedRenderKey !== renderKey;

  useEffect(() => {
    const element = containerRef.current!;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false,
      loadingTask: PDFDocumentLoadingTask | undefined;
    setLoading(true);
    setError('');
    setPDFDocument(null);
    setPageNumber(1);
    setZoom(1);
    async function load() {
      try {
        // Import in the browser only; PDF.js needs browser canvas primitives.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        if (cancelled) return;
        const assets = '/_next/static/pdfjs/' + pdfjs.version + '/';
        pdfjs.GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.min.mjs';
        const response = await fetch(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw Error('PDF request failed');
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        // Only paint PDF page content. No annotation actions, scripting manager
        // or XFA renderer is created. PDF.js 6 removed dynamic JS evaluation;
        // the app CSP also excludes unsafe-eval and WebAssembly evaluation.
        loadingTask = pdfjs.getDocument({
          data,
          cMapUrl: assets + 'cmaps/',
          standardFontDataUrl: assets + 'standard_fonts/',
          wasmUrl: assets + 'wasm/',
          iccUrl: assets + 'iccs/',
          enableXfa: false,
          useWasm: false,
          canvasMaxAreaInBytes: 16_000_000,
        });
        const loaded = await loadingTask.promise;
        if (!cancelled) setPDFDocument(loaded);
      } catch (err) {
        if (!cancelled) {
          setError(
            (err as Error).name === 'PasswordException'
              ? 'This PDF requires a password. Use Open original PDF to view it.'
              : 'The PDF could not be displayed. Retry, or open the original PDF.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      void loadingTask?.destroy().catch(() => {});
    };
  }, [url, attempt]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!pdfDocument || !element || !containerWidth) return;
    let cancelled = false,
      renderTask: RenderTask | undefined;
    setError('');
    async function paint() {
      const pdfPage = await pdfDocument!.getPage(pageNumber);
      try {
        if (cancelled) return;
        const unscaledViewport = pdfPage.getViewport({ scale: 1 });
        const scale = (Math.max(1, containerWidth - 2) / unscaledViewport.width) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          2,
          MAX_CANVAS_SIDE / viewport.width,
          MAX_CANVAS_SIDE / viewport.height,
          Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
        );
        element!.width = Math.max(1, Math.floor(viewport.width * outputScale));
        element!.height = Math.max(1, Math.floor(viewport.height * outputScale));
        element!.style.width = `${viewport.width}px`;
        element!.style.height = `${viewport.height}px`;
        renderTask = pdfPage.render({
          canvas: element!,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
          background: '#ffffff',
        });
        await renderTask.promise;
        if (!cancelled) setPaintedRenderKey(renderKey);
      } finally {
        pdfPage.cleanup();
      }
    }
    void paint().catch(() => {
      if (!cancelled)
        setError('This page could not be displayed. Retry, or open the original PDF.');
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDocument, pageNumber, zoom, containerWidth, renderKey]);

  return (
    <Dialog title={cv?.name || 'Exact submitted CV'} wide onClose={onClose} onBack={onBack}>
      <div className="pdf-meta">
        <span>{cv?.filename}</span>
        {cv && <code title={cv.sha256}>SHA256 {cv.sha256.slice(0, 16)}…</code>}
        <a href={url} target="_blank" rel="noopener noreferrer">
          Open original PDF ↗
        </a>
      </div>
      <div className="pdf-controls" aria-label="PDF controls">
        <button
          disabled={!pdfDocument || pageNumber <= 1}
          onClick={() => setPageNumber((number) => number - 1)}
        >
          Previous page
        </button>
        <span aria-live="polite">
          {pdfDocument ? `Page ${pageNumber} of ${pdfDocument.numPages}` : 'PDF'}
        </span>
        <button
          disabled={!pdfDocument || pageNumber >= pdfDocument.numPages}
          onClick={() => setPageNumber((number) => number + 1)}
        >
          Next page
        </button>
        <label>
          Zoom
          <select
            value={zoom}
            disabled={!pdfDocument}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={1}>Fit width</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
            <option value={3}>300%</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={() => setAttempt((a) => a + 1)}>Retry PDF</button>
        </p>
      )}
      {(loading || rendering) && !error && (
        <p className="loading" role="status">
          {loading ? 'Loading PDF…' : 'Rendering page…'}
        </p>
      )}
      <div className="pdf-viewport" ref={containerRef} aria-busy={(loading || rendering) && !error}>
        {pdfDocument && (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`PDF page ${pageNumber} of ${pdfDocument.numPages}`}
            hidden={loading || rendering || !!error}
          />
        )}
      </div>
      <p className="muted">This is the original immutable PDF saved for this version.</p>
    </Dialog>
  );
}
