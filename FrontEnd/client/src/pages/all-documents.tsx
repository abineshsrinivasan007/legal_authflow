import { useState, useMemo } from "react";
import { Link } from "wouter";
import { FileText, Download, RefreshCw, Home, Search, Filter, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, File, Grid3x3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// We will no longer use initialMockDocuments!
import { useEffect } from "react";

export default function AllDocuments() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [blogs, setBlogs] = useState<any[]>([]);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");

  // Poll Django for the document list
  const fetchDocuments = async () => {
    try {
      const res = await fetch("/api/documents/");
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (e) {
      console.error("Failed to fetch documents", e);
    }
  };

  const fetchBlogs = async () => {
    try {
      const res = await fetch("/api/blogs/");
      if (res.ok) {
        const data = await res.json();
        setBlogs(data);
      }
    } catch (e) {
      console.error("Failed to fetch blogs", e);
    }
  };

  useEffect(() => {
    fetchDocuments();
    fetchBlogs();
    const interval = setInterval(() => {
      fetchDocuments();
      fetchBlogs();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Combine datasets
  const allItems = useMemo(() => {
    const docs = documents.map(d => ({ ...d, sourceType: d.name?.endsWith('.xml') ? 'xml' : 'pdf', displayName: d.name, displayDate: d.upload_date }));
    const bgArticles = blogs.map(b => ({ ...b, sourceType: 'blog', displayName: b.title, displayDate: b.created_date, file: b.source_file }));
    return [...docs, ...bgArticles].sort((a, b) => new Date(b.displayDate).getTime() - new Date(a.displayDate).getTime());
  }, [documents, blogs]);

  // Filtering logic
  const filteredItems = useMemo(() => {
    return allItems.filter((d: any) => {
      let match = true;
      if (statusFilter !== "All") match = d.status === statusFilter;
      if (sourceFilter !== "All") match = match && d.sourceType === sourceFilter;
      if (searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase();
        match = match && (
          d.displayName?.toLowerCase().includes(q) || 
          d.status?.toLowerCase().includes(q)
        );
      }
      return match;
    });
  }, [allItems, statusFilter, sourceFilter, searchQuery]);

  // Calculate displayed items based on pagination
  const displayedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [currentPage, pageSize, filteredItems]);

  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;

  return (
    <Layout defaultSidebarOpen={false}>
      <div className="flex flex-col max-w-[1400px] mx-auto w-full">

        {/* Header & Tabs */}
        <div className="mb-6 flex flex-col gap-6 shrink-0 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-heading font-semibold text-foreground tracking-tight mb-2">
                All Documents
              </h1>
              <p className="text-muted-foreground text-sm">
                View and manage all generated document statuses.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="search" 
                  placeholder="Search archives..." 
                  className="h-10 w-[200px] sm:w-[250px] pl-9 bg-white/50 border-white"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                />
              </div>

              <Select
                value={statusFilter}
                onValueChange={(val) => { setStatusFilter(val); setCurrentPage(1); }}
              >
                <SelectTrigger className="w-[130px] h-10 bg-white/50 border-white">
                  <Filter className="mr-2 h-3.5 w-3.5" />
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Processing">Processing</SelectItem>
                  <SelectItem value="Queued">Queued</SelectItem>
                  <SelectItem value="Failed">Failed</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={sourceFilter}
                onValueChange={(val) => { setSourceFilter(val); setCurrentPage(1); }}
              >
                <SelectTrigger className="w-[130px] h-10 bg-white/50 border-white">
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sources</SelectItem>
                  <SelectItem value="pdf">Uploads</SelectItem>
                  <SelectItem value="blog">Blogs</SelectItem>
                  <SelectItem value="xml">XML Batch</SelectItem>
                </SelectContent>
              </Select>

              <Button 
                onClick={() => { fetchDocuments(); fetchBlogs(); }}
                className="gap-2 bg-white/50 hover:bg-white text-foreground shadow-sm rounded-xl h-10 px-4 transition-all"
              >
                <RefreshCw className="h-4 w-4 text-primary" />
                <span className="font-medium hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-border/60 pb-px">
            <Link href="/dashboard" className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/40 rounded-t-xl transition-colors flex items-center gap-2">
              <Home className="h-4 w-4" />
              Home
            </Link>
            <div className="px-5 py-2.5 text-sm font-medium text-primary bg-white/60 border-b-2 border-primary rounded-t-xl flex items-center gap-2 shadow-sm">
              <FileText className="h-4 w-4" />
              Generated Status
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="glass-card rounded-2xl shadow-sm border border-white mb-8">
          <div className="p-0">
            <table className="w-full text-sm text-left border-collapse table-fixed">
              <thead className="bg-[#fcfdff] backdrop-blur-sm sticky top-0 z-10 border-b border-border text-xs uppercase tracking-wider font-semibold text-slate-500">
                <tr>
                  <th className="px-6 py-4 text-center w-16">Sl.No</th>
                  <th className="px-6 py-4">File Name</th>
                  <th className="px-6 py-4 w-28">Source</th>
                  <th className="px-6 py-4 w-32">Status</th>
                  <th className="px-6 py-4 w-32">Date</th>
                  <th className="px-6 py-4 text-center w-24">Topics</th>
                  <th className="px-6 py-4 text-center w-24">Keywords</th>
                  <th className="px-6 py-4 text-center w-32">Input</th>
                  <th className="px-6 py-4 text-center w-36">Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {displayedItems.map((row, index) => {
                  const actualIndex = (currentPage - 1) * pageSize + index + 1;

                  const handleForceDownload = async (url: string, filename: string) => {
                    try {
                      // Add timestamp to foil caching
                      const fetchUrl = url.includes("?") ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
                      const response = await fetch(fetchUrl);
                      if (!response.ok) {
                        throw new Error(`HTTP ${response.status} - ${response.statusText}`);
                      }
                      const originalBlob = await response.blob();
                      const blob = new Blob([originalBlob], { type: "application/octet-stream" });
                      const blobUrl = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = blobUrl;
                      a.download = filename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      window.URL.revokeObjectURL(blobUrl);
                    } catch (err) {
                      console.error("Failed to download file:", err);
                      alert("Failed to download the document. It might not be available on the server.");
                    }
                  };

                  const handleDownloadResults = () => {
                    let content = `DOCUMENT EXTRACTION RESULTS\n`;
                    content += `===========================\n`;
                    content += `File Name: ${row.displayName}\n`;
                    content += `Status: ${row.status}\n`;
                    content += `Source: ${row.sourceType === 'blog' ? 'RSS/Blog' : 'Manual Upload'}\n`;
                    content += `Processed On: ${row.completed_date ? new Date(row.completed_date).toLocaleString() : 'N/A'}\n\n`;
                    
                    content += `TOPICS DETECTED (${row.topics_count || 0})\n`;
                    content += `-----------------\n`;
                    if (row.topics_list && row.topics_list.length > 0) {
                      row.topics_list.forEach((t: string) => content += `- ${t}\n`);
                    } else {
                      content += `No topics extracted.\n`;
                    }
                    content += `\n`;

                    content += `KEYWORDS DETECTED (${row.keywords_count || 0})\n`;
                    content += `-------------------\n`;
                    if (row.keywords_list && row.keywords_list.length > 0) {
                      row.keywords_list.forEach((k: string) => content += `- ${k}\n`);
                    } else {
                      content += `No keywords extracted.\n`;
                    }
                    content += `\n`;

                    // Add AI SUGGESTED TOPICS
                    const rawSuggestions = (row.ai_topics || row.ai_suggestions || "");
                    const cleanedSuggestions = rawSuggestions
                      .split(/(?:\d+\.\s*|,|\n)/)
                      .map((t: string) => t.trim().replace(/^["'\[]+|["'\]]+$/g, '').replace(/^[^a-zA-Z0-9]+/, '').replace(/\*+/g, ''))
                      .filter((t: string) => t.length > 2);

                    content += `AI SUGGESTED TOPICS (${cleanedSuggestions.length})\n`;
                    content += `--------------------\n`;
                    if (cleanedSuggestions.length > 0) {
                      cleanedSuggestions.forEach((t: string) => content += `- ${t}\n`);
                    } else {
                      content += `No suggested topics extracted.\n`;
                    }

                    const blob = new Blob([content], { type: "text/plain" });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${row.displayName}_results.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  };

                  return (
                    <tr key={row.id} className="hover:bg-white/60 transition-colors group bg-white/20">
                      <td className="px-6 py-4 text-center text-muted-foreground font-mono text-xs truncate">{actualIndex}</td>
                      <td className="px-6 py-4 truncate">
                        <div className="flex items-center gap-3 w-full min-w-0">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${row.sourceType === 'pdf' ? 'bg-red-50 text-red-500' : (row.sourceType === 'xml' ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500')}`}>
                            {row.sourceType === 'pdf' ? <File className="h-4 w-4 shrink-0" /> : (row.sourceType === 'xml' ? <File className="h-4 w-4 shrink-0" /> : <Grid3x3 className="h-4 w-4 shrink-0" />)}
                          </div>
                          <span className="font-medium text-slate-800 truncate block" title={row.displayName}>{row.displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter ${
                          row.sourceType === 'blog' ? 'bg-amber-100 text-amber-700' : (row.sourceType === 'xml' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700')
                        }`}>
                          {row.sourceType === 'blog' ? 'RSS/BLOG' : (row.sourceType === 'xml' ? 'XML BATCH' : 'UPLOAD')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                            row.status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200'
                          : row.status === 'Scanned PDF' ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : (row.status === 'Failed' || row.status === 'Error') ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                        >
                          {row.status === 'Completed' && <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-green-500" />}
                          {row.status === 'Scanned PDF' && <span className="text-amber-500 text-xs shrink-0">⚠</span>}
                          {(row.status === 'Processing' || row.status === 'Pending') && <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-blue-500 animate-pulse" />}
                          {row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                        {new Date(row.displayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <span className="inline-flex items-center justify-center h-7 px-3 rounded-md bg-muted font-mono font-medium text-xs">
                          {row.topics_count || "--"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <span className="inline-flex items-center justify-center h-7 px-3 rounded-md bg-primary/10 text-primary font-mono font-medium text-xs">
                          {row.keywords_count || "--"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center truncate">
                        {row.file ? (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => {
                              let dlName = row.displayName || "document";
                              // Sanitize to prevent OS invalid characters and newlines which break the download attribute
                              dlName = dlName.replace(/[<>:"\/\\|?*\n\r]+/g, '_').trim();
                              
                              if (row.file && row.file.includes('.')) {
                                const ext = row.file.split('.').pop();
                                if (!dlName.endsWith('.' + ext)) {
                                  dlName = dlName + '.' + ext;
                                }
                              }
                              handleForceDownload(row.file, dlName);
                            }}
                            className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                            title={`Download source file`}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center truncate">
                        {row.status === 'Completed' ? (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleDownloadResults}
                            className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                            title="Download Extracted Results (TXT)"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">Wait...</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer Controls */}
          <div className="px-6 py-4 border-t border-border/50 bg-white/50 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-4 text-sm text-muted-foreground font-medium">
              <div className="bg-white px-3 py-1.5 rounded-lg border border-border shadow-sm flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary" />
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredItems.length)} of {filteredItems.length}
              </div>

              <div className="flex items-center gap-2">
                <span>Rows per page</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[70px] h-8 bg-white">
                    <SelectValue placeholder="10" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg bg-white shadow-sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg bg-white shadow-sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <span className="text-sm font-medium px-4">
                Page {currentPage} of {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg bg-white shadow-sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg bg-white shadow-sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}