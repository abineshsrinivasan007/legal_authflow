import { useState, useEffect } from "react";
import { ArrowLeft, FileText, Hash, Tag, Download, Printer, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface Document {
  id: number;
  name: string;
  status: string;
  topics_count: number;
  keywords_count: number;
  topics_list?: string[];
  keywords_list?: string[];
  upload_date: string;
  completed_date?: string;
  process_time?: number;
  file?: string;
  ai_topics?: string;
}

interface TopicKeywordDetailProps {
  documents: Document[];
  blogs: any[];
  onBack: () => void;
}

export function TopicKeywordDetail({ documents, blogs, onBack }: TopicKeywordDetailProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSource, setFilterSource] = useState("All");

  // Combine datasets for the sidebar
  const allItems = [
    ...documents.map(d => ({ ...d, sourceType: d.name?.endsWith('.xml') ? 'xml' : 'pdf', displayName: d.name, displayDate: d.upload_date })),
    ...blogs.map(b => ({ ...b, sourceType: 'blog', displayName: b.title, displayDate: b.created_date, name: b.title, upload_date: b.created_date, file: b.source_file }))
  ].sort((a, b) => new Date(b.displayDate || b.upload_date).getTime() - new Date(a.displayDate || a.upload_date).getTime());

  // Filter based on search and source
  const filteredSidebarItems = allItems.filter(item => {
    const matchesSearch = item.displayName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSource = filterSource === "All" || item.sourceType === filterSource;
    return matchesSearch && matchesSource;
  });

  const [selectedDoc, setSelectedDoc] = useState<any | null>(allItems[0] || null);

  const handleForceDownload = async (url: string, fFilename: string) => {
    try {
      // Force the URL to be relative so it goes through the Vite proxy
      // This avoids "localhost:8001" CORS issues.
      const relativeUrl = url.replace(/^https?:\/\/[^\/]+/, '');
      
      const response = await fetch(relativeUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Failed to download file:", err);
      alert("Failed to download the document. Please ensure the Backend is running on port 8001.");
    }
  };

  const handleDownloadResults = () => {
    if (!selectedDoc) return;

    // Create a plain text dump of results
    let content = `DOCUMENT EXTRACTION RESULTS\n`;
    content += `===========================\n`;
    content += `File Name: ${selectedDoc.name}\n`;
    content += `Status: ${selectedDoc.status}\n`;
    content += `Processed On: ${selectedDoc.completed_date ? new Date(selectedDoc.completed_date).toLocaleString() : 'N/A'}\n\n`;

    content += `TOPICS DETECTED (${selectedDoc.topics_count})\n`;
    content += `-----------------\n`;
    if (selectedDoc.topics_list && selectedDoc.topics_list.length > 0) {
      selectedDoc.topics_list.forEach(t => content += `- ${t}\n`);
    } else {
      content += `No topics extracted.\n`;
    }
    content += `\n`;

    content += `KEYWORDS DETECTED (${selectedDoc.keywords_count})\n`;
    content += `-------------------\n`;
    if (selectedDoc.keywords_list && selectedDoc.keywords_list.length > 0) {
      selectedDoc.keywords_list.forEach(k => content += `- ${k}\n`);
    } else {
      content += `No keywords extracted.\n`;
    }
    content += `\n`;

    // Add AI SUGGESTED TOPICS
    const rawSuggestions = (selectedDoc.ai_topics || selectedDoc.ai_suggestions || "");
    const cleanedSuggestions = rawSuggestions
      .split(/(?:\d+\.\s*|,|\n)/)
      .map((t: string) => t.trim().replace(/^["'\[]+|["'\]]+$/g, '').replace(/^[^a-zA-Z0-9]+/, '').replace(/\*+/g, ''))
      .filter((t: string) => t.length > 2);

    content += `AI SUGGESTED TOPICS (${cleanedSuggestions.length})\n`;
    content += `--------------------\n`;
    if (cleanedSuggestions.length > 0) {
      cleanedSuggestions.forEach(t => content += `- ${t}\n`);
    } else {
      content += `No suggested topics extracted.\n`;
    }

    const blob = new Blob([content], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedDoc.name}_results.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };


  if (!selectedDoc) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No documents available</p>
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState("ai");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
      {/* Left Panel - Document List */}
      <div className="lg:col-span-1 border-r border-slate-200 overflow-y-auto pr-6 custom-scrollbar">
        <div className="space-y-4">
          <button
            onClick={onBack}
            className="group flex items-center gap-2 text-sm text-slate-600 hover:text-primary mb-6 font-medium transition-all"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            Back to Dashboard
          </button>

          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Available Documents
          </h3>

          <div className="space-y-3 mb-6">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Hash className="h-3.5 w-3.5" />
              </span>
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {["All", "pdf", "xml", "blog"].map(src => (
                <button
                  key={src}
                  onClick={() => setFilterSource(src)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${filterSource === src
                    ? "bg-primary text-white shadow-sm"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}
                >
                  {src === "pdf" ? "Uploads" : src === "xml" ? "Batch" : src === "blog" ? "Blogs" : "All"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {filteredSidebarItems.length > 0 ? (
              filteredSidebarItems.map((doc) => (
                <button
                  key={`${doc.sourceType}-${doc.id}`}
                  onClick={() => setSelectedDoc(doc)}
                  className={`w-full text-left p-3 rounded-xl transition-all border ${selectedDoc.id === doc.id && selectedDoc.sourceType === doc.sourceType
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-transparent hover:bg-slate-50 hover:border-slate-200"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border ${doc.sourceType === "xml" ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                        doc.sourceType === "blog" ? "bg-amber-50 text-amber-600 border-amber-100" :
                          "bg-indigo-50 text-indigo-600 border-indigo-100"
                        }`}
                    >
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold truncate ${selectedDoc.id === doc.id && selectedDoc.sourceType === doc.sourceType ? "text-primary" : "text-slate-700"}`}>
                        {doc.displayName || doc.name}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="text-center py-10">
                <p className="text-xs text-slate-400">No results found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Document Details */}
      <div className="lg:col-span-2 overflow-y-auto pl-2 custom-scrollbar pr-2">
        {selectedDoc.status === "Completed" ? (
          <div className="space-y-8">
            <div className="flex items-center gap-3">

              <button
                onClick={() => setActiveTab("ai")}
                className={`px-4 py-2 font-semibold ${activeTab === "ai" ? "border-b-2 border-primary-600 text-primary-600" : "text-gray-500"
                  }`}
              >
                AI Extraction
              </button>

              <button
                onClick={() => setActiveTab("faq")}
                className={`px-4 py-2 font-semibold ${activeTab === "faq" ? "border-b-2 border-primary-600 text-primary-600" : "text-gray-500"
                  }`}
              >
                FAQ
              </button>
            </div>
            {/* Tab Content */}
            <div className="mt-6">

              {activeTab === "ai" && (
                <div>
                  {/* Your Existing Data */}
                  {/* Document Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">

                    <div className="flex items-center gap-4">
                      <div className={`h-14 w-14 rounded-xl border flex items-center justify-center ${selectedDoc.sourceType === 'xml' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                        selectedDoc.sourceType === 'blog' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                          'bg-red-50 text-red-600 border-red-100'
                        }`}>
                        <FileText className="h-7 w-7" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                          {selectedDoc.name}
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5 font-medium">
                          Processed on {selectedDoc.completed_date
                            ? new Date(selectedDoc.completed_date).toLocaleDateString()
                            : "N/A"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedDoc.file && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleForceDownload(selectedDoc.file!, selectedDoc.name)}
                          className="rounded-lg h-9 font-medium bg-primary hover:bg-primary/90 shadow-lg shadow-primary/10"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download {selectedDoc.sourceType === 'pdf' ? 'PDF' : 'XML'}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadResults}
                        className="rounded-lg h-9 font-medium text-slate-600 border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        <Printer className="h-4 w-4 mr-2" />
                        Export TXT
                      </Button>
                    </div>
                  </div>

                  {/* Simple Stats Grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Topics</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-bold text-slate-900">{selectedDoc.topics_count}</p>
                        <Hash className="h-3.5 w-3.5 text-primary opacity-40" />
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Keywords</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-bold text-slate-900">{selectedDoc.keywords_count}</p>
                        <Tag className="h-3.5 w-3.5 text-primary opacity-40" />
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 hidden lg:block">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Status</p>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        <p className="text-sm font-semibold text-slate-700">Verified</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 hidden lg:block">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Time</p>
                      <p className="text-sm font-semibold text-slate-700">{selectedDoc.process_time}s</p>
                    </div>
                  </div>

                  {/* Analysis Sections */}
                  <div className="space-y-10">
                    <div className="space-y-6">
                      <div className="bg-white/40 border border-slate-100 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Topics</h3>
                          <div className="h-px flex-1 bg-slate-100" />
                        </div>
                        <div className="relative group">
                          {/* Scrollable Container */}
                          <div className="max-h-[160px] overflow-y-auto pr-2 custom-scrollbar flex flex-wrap gap-2 py-2 mask-fade-y">
                            {selectedDoc.topics_list?.map((topic: string, i: number) => (
                              <span key={i} className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm hover:border-primary/30 transition-colors">
                                {topic}
                              </span>
                            ))}
                          </div>
                          {/* Hint for scrolling */}
                          {selectedDoc.topics_list && selectedDoc.topics_list.length > 8 && (
                             <div className="absolute -bottom-1 right-2 text-[9px] font-bold text-primary/30 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">Scroll for more ↓</div>
                          )}
                        </div>
                      </div>

                      <div className="bg-white/40 border border-slate-100 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Key Terms</h3>
                          <div className="h-px flex-1 bg-slate-100" />
                        </div>
                        <div className="relative group">
                          <div className="max-h-[160px] overflow-y-auto pr-2 custom-scrollbar flex flex-wrap gap-2 py-2 mask-fade-y">
                            {selectedDoc.keywords_list?.map((keyword: string, i: number) => (
                              <span key={i} className="bg-primary/5 text-primary border border-primary/10 px-3 py-1.5 rounded-full text-xs font-bold hover:bg-primary/10 transition-colors">
                                {keyword}
                              </span>
                            ))}
                          </div>
                          {selectedDoc.keywords_list && selectedDoc.keywords_list.length > 12 && (
                             <div className="absolute -bottom-1 right-2 text-[9px] font-bold text-primary/30 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">Scroll for more ↓</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Advanced AI Overarching Themes */}
                    {(selectedDoc.ai_topics || selectedDoc.ai_suggestions) && (
                      <div className="space-y-4 pb-10 mt-6 bg-purple-50/30 border border-purple-100/50 rounded-2xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <h3 className="text-sm font-bold text-purple-800 uppercase tracking-wide">AI Suggest Topics</h3>
                          <div className="h-px flex-1 bg-purple-100" />
                        </div>
                        <div className="relative group">
                          <div className="max-h-[160px] overflow-y-auto pr-2 custom-scrollbar flex flex-wrap gap-2 py-2 mask-fade-y">
                            {(selectedDoc.ai_topics || selectedDoc.ai_suggestions)
                              .split(/(?:\d+\.\s*|,|\n)/)
                              .map((t: any) => t.trim()
                                .replace(/^["'\[]+|["'\]]+$/g, '') // Remove quotes and brackets at start/end
                                .replace(/^[^a-zA-Z0-9]+/, '')      // Remove any leading symbols
                                .replace(/\*+/g, '')               // Remove asterisks
                              )
                              .filter((t: any) => t.length > 2)
                              .map((topic: any, i: number) => (
                                <span key={i} className="bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm transition-colors hover:bg-purple-100">
                                  {topic}
                                </span>
                              ))}
                          </div>
                          <div className="absolute -bottom-1 right-2 text-[9px] font-bold text-purple-400/50 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">AI Analysis ↓</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "faq" && (
                <div>
                  <p>Beta Feature in Development</p>
                </div>
              )}
            </div>
          </div>




        ) : selectedDoc.status === "Scanned PDF" ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="h-20 w-20 rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center mb-6">
              <span className="text-4xl">🖼️</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Scanned / Image-Based PDF</h3>
            <p className="text-sm text-slate-500 max-w-sm mt-1 leading-relaxed">
              This document appears to be a <strong>scanned image PDF</strong> with no extractable text layer.
              Our AI pipeline requires readable digital text to perform topic and keyword extraction.
            </p>
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 max-w-sm text-left">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">What you can do</p>
              <ul className="text-sm text-amber-700 space-y-1.5 list-disc list-inside">
                <li>Use a PDF with a real digital text layer</li>
                <li>Run OCR software (e.g. Adobe Acrobat) on this file first</li>
                <li>Re-export the source document directly as a digital PDF</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-20 grayscale opacity-70">
            <FileText className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900">Analysis in Progress</h3>
            <p className="text-sm text-slate-500 max-w-xs mt-2">We are currently extracting semantic information from this document. Please wait a moment.</p>
          </div>
        )}
      </div>
    </div>

  );
}
