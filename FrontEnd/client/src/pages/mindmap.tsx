import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Network, FileText, RefreshCw } from "lucide-react";
import { Layout } from "@/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import mermaid from "mermaid";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Maximize, ZoomIn, ZoomOut, Expand, Shrink, ArrowLeft } from "lucide-react";

interface DocumentData {
  id: number;
  name: string;
  status: string;
  topics_list?: string[];
  mindmap_data?: { name: string; parent: string }[];
}

// ─── Defined OUTSIDE parent to prevent component type churn ──────────────────
interface CanvasProps {
  svgRef: React.RefObject<HTMLDivElement | null>;
  docId: string;
  onDoubleClick?: () => void;
}

function MindmapCanvas({ svgRef, docId, onDoubleClick }: CanvasProps) {
  const transformComponentRef = useRef<any>(null);

  useEffect(() => {
    // We observe the svgRef container because mermaid renders the SVG asynchronously
    const target = svgRef.current;
    if (!target) return;

    const observer = new MutationObserver(() => {
      // Find the root node by class (defined in mermaidChartText)
      const rootNode = target.querySelector('.root-1') || target.querySelector('rect') || target.querySelector('circle');

      if (rootNode && transformComponentRef.current) {
        const { zoomToElement } = transformComponentRef.current;
        // Zoom to the root node with a more prominent scale
        setTimeout(() => {
          zoomToElement(rootNode as HTMLElement, 1.4, 600);
        }, 150);
      }
    });

    observer.observe(target, { childList: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div key={docId} className="flex-1 w-full h-full relative">
      <TransformWrapper
        ref={transformComponentRef}
        initialScale={1}
        minScale={0.05}
        maxScale={8}
        limitToBounds={false}
      >
        {({ zoomIn, zoomOut, centerView }) => (
          <>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-white/90 backdrop-blur-md p-1.5 rounded-full shadow-lg border border-slate-200/60">
              <Button variant="ghost" size="icon" onClick={() => zoomOut(0.5)} className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-600" title="Zoom out">
                <ZoomOut className="h-5 w-5" />
              </Button>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <Button variant="ghost" size="icon" onClick={() => centerView(1)} className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-600" title="Fit to screen">
                <Maximize className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <Button variant="ghost" size="icon" onClick={() => zoomIn(0.5)} className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-600" title="Zoom in">
                <ZoomIn className="h-5 w-5" />
              </Button>
            </div>
            <TransformComponent wrapperClass="!w-full !h-full cursor-move" contentClass="!w-full !h-full flex items-center justify-center p-4 sm:p-10">
              <div ref={svgRef} onDoubleClick={onDoubleClick} className="flex items-center justify-center min-w-[2000px] min-h-[1000px]" />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function MindmapView() {
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("all");
  const [isRenderError, setIsRenderError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [topicLimit, setTopicLimit] = useState<number>(15);

  const normalRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  // Esc closes fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch("/api/documents/");
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
        setSelectedDocId(prev => {
          if (prev === "all" && data.length > 0) {
            const first = data.find((d: DocumentData) => d.status === "Completed" && (d.mindmap_data || []).length > 0);
            return first ? first.id.toString() : prev;
          }
          return prev;
        });
      }
    } catch (e) {
      console.error("Failed to fetch documents", e);
    }
  };

  useEffect(() => {
    fetchDocuments();
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, []);

  const [aiMindmapData, setAiMindmapData] = useState<{ name: string, parent: string }[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Group all topics from all completed documents
  const allTopics = useMemo(() => {
    const normalizeTopic = (str: string) => {
      return str.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    };

    const dict: Record<string, string> = {};
    documents.forEach(doc => {
      if (doc.status === 'Completed' && Array.isArray(doc.topics_list)) {
        doc.topics_list.forEach(topic => {
          const normKey = normalizeTopic(topic) || topic.toLowerCase().trim();
          if (!dict[normKey] || (topic.length < dict[normKey].length && !topic.includes('('))) {
            dict[normKey] = topic.trim();
          }
        });
      }
    });

    return Object.values(dict);
  }, [documents]);

  const generateAIMindmap = async () => {
    if (!allTopics.length) return;
    setIsGenerating(true);
    setIsRenderError(false);
    try {
      // Pass topics to Mistral (limit to top N to avoid huge token costs randomly)
      const topTopics = allTopics.slice(0, topicLimit === 1000 ? 50 : topicLimit);

      const res = await fetch("/api/global-mindmap/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: topTopics })
      });

      if (!res.ok) throw new Error("Failed to generate AI mindmap");
      const data = await res.json();
      setAiMindmapData(data);
    } catch (e) {
      console.error(e);
      setIsRenderError(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const mermaidChartText = useMemo(() => {
    if (!aiMindmapData || aiMindmapData.length === 0) return null;

    let chart = "flowchart LR\n";
    chart += "  classDef root-1 fill:#f5f3ff,stroke:#9333ea,stroke-width:4px,color:#581c87,font-weight:bold\n";
    chart += "  classDef topic fill:#f1f5f9,stroke:#94a3b8,stroke-width:2px,color:#0f172a,font-weight:bold\n";

    const sanitize = (t: string | undefined | null) => {
      if (!t) return "Empty";
      return String(t).replace(/["\n\r]/g, "").trim() || "Empty";
    };

    const idMap = new Map<string, string>();
    let idCounter = 0;
    const getId = (name: string) => {
      const cleanName = sanitize(name).toLowerCase();
      if (!idMap.has(cleanName)) {
        idMap.set(cleanName, `N${idCounter++}`);
      }
      return idMap.get(cleanName)!;
    };

    // Keep track of which nodes we've defined labels for
    const definedNodes = new Set<string>();

    aiMindmapData.forEach(item => {
      const parentName = item.parent || "Empty";
      const childName = item.name || "Empty";

      const pId = getId(parentName);
      const cId = getId(childName);

      if (!definedNodes.has(pId)) {
        chart += `  ${pId}["${sanitize(parentName)}"]\n`;
        // If it's a root (Global Legal Topics), give it root class
        if (parentName.toLowerCase().includes("global")) {
          chart += `  class ${pId} root\n`;
        } else {
          chart += `  class ${pId} topic\n`;
        }
        definedNodes.add(pId);
      }

      if (!definedNodes.has(cId)) {
        chart += `  ${cId}["${sanitize(childName)}"]\n`;
        chart += `  class ${cId} topic\n`;
        definedNodes.add(cId);
      }

      chart += `  ${pId} --> ${cId}\n`;
    });

    return chart;
  }, [aiMindmapData]);

  const renderInto = useCallback((target: HTMLDivElement | null) => {
    if (!mermaidChartText || !target) return;
    setIsRenderError(false);
    try {
      mermaid.initialize({
        startOnLoad: false, theme: "base", securityLevel: "loose",
        flowchart: { htmlLabels: true, curve: "basis", nodeSpacing: 100, rankSpacing: 150 }
      });
      target.innerHTML = "";
      mermaid.render(`mermaid-${Date.now()}`, mermaidChartText).then(({ svg }) => {
        if (target) {
          target.innerHTML = svg;
          const el = target.querySelector("svg");
          if (el) {
            el.style.width = "auto";
            el.style.height = "auto";
            el.style.minWidth = "1200px";
          }
        }
      }).catch(() => setIsRenderError(true));
    } catch { setIsRenderError(true); }
  }, [mermaidChartText]);

  // Normal mode render
  useEffect(() => {
    if (!isFullscreen) renderInto(normalRef.current);
  }, [mermaidChartText, isFullscreen, renderInto]);

  // Fullscreen render — use requestAnimationFrame so portal DOM is committed first
  useEffect(() => {
    if (!isFullscreen) return;
    const rafId = requestAnimationFrame(() => {
      renderInto(fullscreenRef.current);
    });
    return () => cancelAnimationFrame(rafId);
  }, [isFullscreen, mermaidChartText, renderInto]);

  const hasData = !!mermaidChartText && !isRenderError;

  return (
    <Layout>
      <div className="h-full flex flex-col max-w-none px-4 lg:px-6 mx-auto w-full">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0 mt-2">
          <div>
            <h1 className="text-3xl font-heading font-semibold text-foreground tracking-tight mb-2">
              Global Topic MindMap
            </h1>
            <p className="text-muted-foreground text-sm">Visualize the structural hierarchy of all global topics mapped to their respective documents.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Select value={topicLimit.toString()} onValueChange={(val) => {
              setTopicLimit(Number(val));
              setAiMindmapData(null); // Clear map if they change limit to prompt generation
            }}>
              <SelectTrigger className="h-10 w-full sm:w-[180px] bg-white border-white/60 shadow-sm text-sm">
                <Network className="mr-2 h-4 w-4 text-primary" />
                <SelectValue placeholder="Topic Limit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">Top 10 Topics</SelectItem>
                <SelectItem value="15">Top 15 Topics</SelectItem>
                <SelectItem value="30">Top 30 Topics</SelectItem>
                <SelectItem value="1000">All Topics</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="default"
              className="h-10 shadow-sm"
              onClick={generateAIMindmap}
              disabled={isGenerating || allTopics.length === 0}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? "Analyzing..." : "Generate Mindmap"}</span>
            </Button>
          </div>
        </div>

        {/* Normal canvas card */}
        <div className="glass-card rounded-2xl flex-1 flex flex-col min-h-[75vh] 2xl:min-h-[85vh] shadow-lg border border-white/60 overflow-hidden relative bg-slate-50/80 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
          {hasData && (
            <div className="absolute top-4 right-4 z-30">
              <Button variant="outline" size="icon" onClick={() => setIsFullscreen(true)}
                className="bg-white/90 backdrop-blur-md hover:bg-white text-slate-700 h-11 w-11 rounded-xl shadow-md border border-slate-200/60 transition-all hover:scale-105"
                title="Full view (or double-click canvas)">
                <Expand className="h-5 w-5" />
              </Button>
            </div>
          )}

          {!mermaidChartText ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-white/40 backdrop-blur-sm">
              <div className={`h-20 w-20 bg-slate-100 rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-slate-200 transition-transform ${isGenerating ? 'animate-pulse' : 'rotate-3 hover:rotate-6'}`}>
                <Network className={`h-10 w-10 ${isGenerating ? 'text-primary' : 'text-slate-400'}`} />
              </div>
              <h3 className="font-semibold text-foreground text-xl mb-2">
                {isGenerating ? "Deep-structuring topics..." : "Ready to Build Global Mindmap"}
              </h3>
              <p className="max-w-[400px] text-center">
                {isGenerating
                  ? "Analyzing semantic relationships to build your custom taxonomy."
                  : "Click 'Generate Mindmap' above to use advanced clustering to logically group and structure your extracted topics."}
              </p>
            </div>
          ) : isRenderError ? (
            <div className="flex-1 flex flex-col items-center justify-center text-red-500 bg-red-50/50 backdrop-blur-sm">
              <h3 className="font-semibold text-red-700 text-xl mb-2">Rendering Error</h3>
              <p>The topic network is too complex to display.</p>
            </div>
          ) : (
            <MindmapCanvas svgRef={normalRef} docId="global" onDoubleClick={() => setIsFullscreen(true)} />
          )}
        </div>
      </div>

      {/* ── FULLSCREEN PORTAL ─────────────────────────────────────────────────
          Renders directly to document.body at z-index 99999.
          Covers the entire website (sidebar + header) while leaving the
          browser chrome (address bar, tabs) visible.
      ──────────────────────────────────────────────────────────────────────── */}
      {isFullscreen && hasData && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", flexDirection: "column" }}
          className="bg-slate-50 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"
        >
          {/* Back — top-left */}
          <div style={{ position: "absolute", top: 24, left: 24, zIndex: 100000 }}>
            <Button onClick={() => setIsFullscreen(false)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl rounded-xl h-11 px-5 flex items-center gap-2">
              <ArrowLeft className="h-5 w-5" />
              <span className="font-semibold">Back to Dashboard</span>
            </Button>
          </div>

          {/* Shrink — top-right */}
          <div style={{ position: "absolute", top: 24, right: 24, zIndex: 100000 }}>
            <Button variant="outline" size="icon" onClick={() => setIsFullscreen(false)}
              className="bg-white/90 backdrop-blur-md hover:bg-white text-slate-700 h-11 w-11 rounded-xl shadow-md border border-slate-200"
              title="Exit fullscreen (Esc)">
              <Shrink className="h-5 w-5" />
            </Button>
          </div>

          <MindmapCanvas svgRef={fullscreenRef} docId="global" onDoubleClick={() => setIsFullscreen(false)} />
        </div>,
        document.body
      )}
    </Layout>
  );
}
