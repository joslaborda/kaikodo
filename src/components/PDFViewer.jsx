import { useEffect, useRef, useState, useCallback } from 'react';
import { FileText, X, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function PDFViewer({ fileUrl, onClose }) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const canvasRefs   = useRef({});
  const [pdfDoc, setPdfDoc]     = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [zoom, setZoom]         = useState(1);
  const [rendered, setRendered] = useState({});
  const lastDist = useRef(null);

  const isPDF = fileUrl?.toLowerCase().includes('.pdf') || fileUrl?.toLowerCase().includes('application/pdf');
  const isImg = fileUrl && /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(fileUrl);
  const fileName = fileUrl?.split('/').pop()?.split('?')[0] || t('pdfViewer.defaultName');

  // ESC to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Load PDF
  useEffect(() => {
    if (!fileUrl || !isPDF) { setLoading(false); return; }
    // `cancelled` evita dos problemas: (1) si `fileUrl` cambia mientras la
    // carga anterior seguía en vuelo (o el componente se desmonta), sin esto
    // llegaban a fijarse pdfDoc/pageCount de un documento que ya no es el
    // actual; (2) da el punto donde destruir el pdfDoc previo — antes nunca
    // se llamaba a `pdf.destroy()`, así que cada documento abierto (y cada
    // vez que Documents.jsx cambiaba de fileUrl) dejaba su worker de pdf.js
    // y los buffers de página vivos en memoria para siempre.
    let cancelled = false;
    let localPdf = null;
    const load = async () => {
      try {
        setLoading(true); setError(null);
        let lib = window['pdfjs-dist/build/pdf'];
        if (!lib) {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          document.head.appendChild(s);
          await new Promise((res, rej) => { s.onload = res; s.onerror = rej; });
          lib = window['pdfjs-dist/build/pdf'];
        }
        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await lib.getDocument(fileUrl).promise;
        if (cancelled) { pdf.destroy(); return; }
        localPdf = pdf;
        setPdfDoc(pdf);
        setPageCount(pdf.numPages);
        setLoading(false);
      } catch {
        if (!cancelled) { setError(t('pdfViewer.loadError')); setLoading(false); }
      }
    };
    load();
    return () => {
      cancelled = true;
      if (localPdf) localPdf.destroy();
    };
  }, [fileUrl, isPDF]);

  // Render a page into its canvas
  const renderPage = useCallback(async (pdf, num, scale) => {
    const canvas = canvasRefs.current[num];
    if (!canvas || !pdf) return;
    const page = await pdf.getPage(num);
    const vp = page.getViewport({ scale });
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    setRendered(r => ({ ...r, [num]: true }));
  }, []);

  // Re-render all pages when zoom changes
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    setRendered({});
    const scale = 1.8 * zoom;
    for (let i = 1; i <= pageCount; i++) renderPage(pdfDoc, i, scale);
  }, [pdfDoc, pageCount, zoom, renderPage]);

  // Pinch-to-zoom
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastDist.current = Math.sqrt(dx*dx + dy*dy);
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && lastDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const delta = dist / lastDist.current;
      setZoom(z => Math.min(4, Math.max(0.5, z * delta)));
      lastDist.current = dist;
    }
  };
  const onTouchEnd = () => { lastDist.current = null; };
  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => Math.min(4, Math.max(0.5, z - e.deltaY * 0.005)));
    }
  };

  if (!fileUrl) return null;

  return (
    /* El contenido (barras negras translúcidas, texto blanco a varias
       opacidades, sombra del canvas) está diseñado como un "lightbox" sobre
       fondo oscuro fijo, no sobre el token de tema — antes usaba
       hsl(var(--background)), que en modo claro es un fondo casi blanco, y
       los textos blancos translúcidos (cargando/error/sin vista previa)
       quedaban casi invisibles encima. */
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#141414' }}>

      {/* Top bar — el padding-top suma el "safe area" del notch/isla
          dinámica (iOS) o la barra de estado (Android) a los 12px propios
          (py-3): sin esto la X de cerrar quedaba pegada arriba del todo de
          la pantalla, debajo/solapada con el notch, y costaba tocarla. */}
      <div className="flex items-center justify-between px-5 pb-3 shrink-0" style={{ background: 'rgba(0,0,0,.5)', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <div className="w-8" />
        <p className="text-sm font-medium truncate max-w-xs" style={{ color: 'rgba(255,255,255,.75)' }}>{fileName}</p>
        <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,.1)' }}>
          <X className="w-5 h-5" style={{ color: 'rgba(255,255,255,.8)' }} />
        </button>
      </div>

      {/* Scrollable content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        style={{ overscrollBehavior: 'contain' }}
      >
        {loading && (
          <p className="text-sm text-center mt-12" style={{ color: 'rgba(255,255,255,.4)' }}>{t('utilities.loading')}</p>
        )}
        {error && (
          <div className="text-center mt-12">
            <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,.4)' }}>{error}</p>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
              {t('pdfViewer.openNewTab')}
            </a>
          </div>
        )}

        {/* PDF — all pages scrollable */}
        {!loading && !error && isPDF && (
          <div className="flex flex-col items-center gap-3 py-4 px-2">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map(num => (
              <div key={num} className="relative" style={{ maxWidth: '100%' }}>
                {!rendered[num] && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg"
                    style={{ background: 'rgba(255,255,255,.05)', minHeight: 200 }}>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,.3)' }}>{t('pdfViewer.pageLoading', { num })}</span>
                  </div>
                )}
                <canvas
                  ref={el => { canvasRefs.current[num] = el; }}
                  className="rounded-lg shadow-2xl"
                  style={{ maxWidth: '100%', display: 'block' }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Image */}
        {!loading && isImg && (
          <div className="flex justify-center py-4 px-2">
            <img src={fileUrl} alt={fileName}
              style={{ maxWidth: '100%', borderRadius: 8, display: 'block', transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s ease-out' }} />
          </div>
        )}

        {/* Unsupported */}
        {!loading && !error && !isPDF && !isImg && (
          <div className="text-center mt-12">
            <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,.4)' }}>{t('pdfViewer.noPreview')}</p>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white"
              style={{ background: 'rgba(255,255,255,.12)' }}>
              <Download className="w-4 h-4" />{t('pdfViewer.openFile')}
            </a>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 px-5 py-3 flex items-center justify-between" style={{ background: 'rgba(0,0,0,.5)' }}>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-lg font-light"
            style={{ background: 'rgba(255,255,255,.1)' }}>−</button>
          <span className="text-xs w-10 text-center" style={{ color: 'rgba(255,255,255,.5)' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(4, z + 0.25))}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-lg font-light"
            style={{ background: 'rgba(255,255,255,.1)' }}>+</button>
        </div>
        {isPDF && pageCount > 0 && (
          <span className="text-xs" style={{ color: 'rgba(255,255,255,.4)' }}>{t('pdfViewer.pageCount', { count: pageCount })}</span>
        )}
        <a href={fileUrl} download target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white"
          style={{ background: 'rgba(255,255,255,.12)' }}>
          <Download className="w-4 h-4" />{t('pdfViewer.download')}
        </a>
      </div>
    </div>
  );
}
