import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { Upload, File, MoreHorizontal, Filter, ArrowUpRight, BarChart2, FileText, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X, Grid3x3, List, Search } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TopicKeywordDetail } from "@/components/topic-keyword-detail";

// Dashboard component
export default function Dashboard() {
  // LIVE DATA FROM DJANGO
  const [documents, setDocuments] = useState<any[]>([]);
  const [blogs, setBlogs] = useState<any[]>([]);
  const [isViewAll, setIsViewAll] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'detail'>('table');
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

  // Poll the database every 2 seconds to check if documents finished Processing
  useEffect(() => {
    fetchDocuments();
    fetchBlogs();
    const interval = setInterval(() => {
      fetchDocuments();
      fetchBlogs();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    setUploadError(null);

    // Check for rejected files (size, type, etc)
    if (rejectedFiles && rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      if (rejection.errors[0]?.code === 'file-too-large') {
        setUploadError('File size exceeds 200MB limit');
      } else if (rejection.errors[0]?.code === 'file-invalid-type') {
        setUploadError(`Invalid file type. Only PDF files are supported.`);
      } else {
        setUploadError('File validation failed. Please try again.');
      }
      return;
    }

    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];

      // Double-check file extension
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setUploadError(`Invalid file type: ${file.name}. Only PDF files are supported.`);
        return;
      }

      // Check file size
      if (file.size > 209715200) { // 200MB
        setUploadError('File size exceeds 200MB limit');
        return;
      }

      setUploadFile(file);
      setUploadError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    maxSize: 209715200 // 200MB
  });

  // Combine documents and blogs for display
  const allItems = useMemo(() => {
    const docs = documents.map(d => ({ ...d, sourceType: d.name?.endsWith('.xml') ? 'xml' : 'pdf', displayName: d.name, displayDate: d.upload_date }));
    const bgArticles = blogs.map(b => ({ ...b, sourceType: 'blog', displayName: b.title, displayDate: b.created_date }));
    return [...docs, ...bgArticles].sort((a, b) => new Date(b.displayDate).getTime() - new Date(a.displayDate).getTime());
  }, [documents, blogs]);

  // Display calculations
  const filteredDocuments = useMemo(() => {
    if (!allItems) return [];
    return allItems.filter((d: any) => {
      let match = true;
      if (statusFilter !== "All") match = d.status === statusFilter;
      if (sourceFilter !== "All") match = match && d.sourceType === sourceFilter;
      if (searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase();
        match = match && (
          d.displayName?.toLowerCase().includes(q) || 
          d.status?.toLowerCase().includes(q) ||
          (Array.isArray(d.topics_list) && d.topics_list.some((t: string) => t.toLowerCase().includes(q))) ||
          (Array.isArray(d.keywords_list) && d.keywords_list.some((k: string) => k.toLowerCase().includes(q)))
        );
      }
      return match;
    });
  }, [allItems, statusFilter, searchQuery]);

  const displayedItems = useMemo(() => {
    if (filteredDocuments.length === 0) return [];
    if (!isViewAll) {
      return filteredDocuments.slice(0, 10);
    }
    const startIndex = (currentPage - 1) * pageSize;
    return filteredDocuments.slice(startIndex, startIndex + pageSize);
  }, [isViewAll, currentPage, pageSize, filteredDocuments]);

  const totalPages = Math.ceil(filteredDocuments.length / pageSize) || 1;

  const processedCount = useMemo(() => {
    return documents.filter((d: any) => d.status === 'Completed').length;
  }, [documents]);

  const avgTime = useMemo(() => {
    const completed = documents.filter((d: any) => d.status === 'Completed' && d.process_time);
    if (completed.length === 0) return "0.0s";
    const sum = completed.reduce((acc: number, d: any) => acc + parseFloat(d.process_time), 0);
    return (sum / completed.length).toFixed(1) + "s";
  }, [documents]);

  const handleUploadSubmit = async () => {
    if (!uploadFile) return;
    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      // Send actual file stream to Django
      const res = await fetch("/api/documents/", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        await fetchDocuments(); // Refresh table immediately
        setIsUploadOpen(false);
        setUploadFile(null);
      } else {
        const errorData = await res.json();
        setUploadError(errorData.error || "Upload failed. Please try again.");
      }
    } catch (e) {
      setUploadError("Network error. Please check your connection and try again.");
      console.error(e);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Layout>
      <div className="h-full flex flex-col max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0">
          <div>
            <h1 className="text-3xl font-heading font-semibold text-foreground tracking-tight mb-2">
              Keyword & Topic Identification
            </h1>
            <p className="text-muted-foreground text-sm">
              Upload documents to automatically extract legal topics and key entities.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="glass-card rounded-xl border-dashed px-4 py-2 flex items-center gap-4 text-sm mr-2 hidden md:flex">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Processed</span>
                <span className="font-semibold text-foreground">{processedCount.toLocaleString()}</span>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Avg Time</span>
                <span className="font-semibold text-foreground">{avgTime}</span>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center border border-border/30 rounded-xl bg-white/50 p-1 gap-1">
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all text-sm font-medium ${viewMode === 'table'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
                title="Table View"
              >
                <List className="h-4 w-4" />
                <span className="hidden sm:inline">Table</span>
              </button>
              <button
                onClick={() => setViewMode('detail')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all text-sm font-medium ${viewMode === 'detail'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
                title="Detail View"
              >
                <Grid3x3 className="h-4 w-4" />
                <span className="hidden sm:inline">Detail</span>
              </button>
            </div>

            <Dialog open={isUploadOpen} onOpenChange={(open) => {
              setIsUploadOpen(open);
              if (!open) {
                setUploadFile(null);
                setUploadError(null);
              }
            }}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 rounded-xl h-11 px-6 transition-all active:scale-95">
                  <Upload className="h-4 w-4" />
                  <span className="font-medium">Upload Document</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-border/50 bg-white/95 backdrop-blur-xl">
                <div className="p-6">
                  <DialogHeader className="mb-6">
                    <DialogTitle className="text-xl font-heading text-primary">Upload Document</DialogTitle>
                    <DialogDescription>
                      Upload a legal document to extract topics and keywords. Only PDF files are supported (max 200MB).
                    </DialogDescription>
                  </DialogHeader>

                  {uploadError && (
                    <div className={`mb-4 p-4 rounded-xl text-sm border ${uploadError.toLowerCase().includes('scanned') || uploadError.toLowerCase().includes('image-based')
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                      <p className="font-bold mb-1">
                        {uploadError.toLowerCase().includes('scanned') || uploadError.toLowerCase().includes('image-based')
                          ? '🖼️ Scanned PDF Rejected'
                          : '❌ Upload Failed'}
                      </p>
                      <p className="leading-relaxed">{uploadError}</p>
                    </div>
                  )}

                  {!uploadFile ? (
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer ${isDragActive
                        ? "border-primary bg-primary/10"
                        : "border-primary/20 bg-primary/5 hover:bg-primary/10"
                        }`}
                    >
                      <input {...getInputProps()} />
                      <div className={`h-16 w-16 rounded-full bg-white flex items-center justify-center shadow-sm transition-transform ${isDragActive ? "scale-110" : ""}`}>
                        <Upload className="h-8 w-8 text-primary" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-foreground mb-1">
                          {isDragActive ? "Drop the PDF file here..." : "Click to upload or drag and drop"}
                        </p>
                        <p className="text-xs text-muted-foreground">PDF only, up to 200MB</p>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-border rounded-xl p-3 grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-white shadow-sm w-full">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${uploadFile.name.toLowerCase().endsWith('.pdf') ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'}`}>
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col min-w-0 overflow-hidden">
                          <span className="font-medium text-sm truncate block w-full" title={uploadFile.name}>{uploadFile.name}</span>
                          <span className="text-xs text-muted-foreground">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); setUploadFile(null); }} disabled={isUploading}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="px-6 py-4 bg-muted/30 border-t border-border/50 flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setIsUploadOpen(false)} disabled={isUploading}>
                    Cancel
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={handleUploadSubmit}
                    disabled={!uploadFile || isUploading}
                  >
                    {isUploading ? (
                      <>
                        <span className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Upload
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Content Area */}
        {viewMode === 'detail' ? (
          <div className="glass-card rounded-2xl flex-1 flex flex-col min-h-0 shadow-sm border border-white p-6">
            <TopicKeywordDetail
              documents={documents}
              blogs={blogs}
              onBack={() => setViewMode('table')}
            />
          </div>
        ) : (
          <div className="glass-card rounded-2xl flex-1 flex flex-col min-h-0 shadow-sm border border-white">
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between bg-white/50 shrink-0">
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 p-1.5 rounded-lg">
                  <BarChart2 className="h-4 w-4 text-primary" />
                </div>
                <h2 className="font-semibold text-foreground">
                  {isViewAll ? "All Documents" : "Recent Documents"}
                </h2>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="search" 
                    placeholder="Search documents..." 
                    className="h-8 w-[150px] sm:w-[220px] pl-8 text-sm"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  />
                </div>
                
                <Select
                  value={statusFilter}
                  onValueChange={(val) => { setStatusFilter(val); setCurrentPage(1); }}
                >
                  <SelectTrigger className="w-[130px] h-8 bg-white text-sm">
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
                  <SelectTrigger className="w-[130px] h-8 bg-white text-sm">
                    <Grid3x3 className="mr-2 h-3.5 w-3.5" />
                    <SelectValue placeholder="All Sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Sources</SelectItem>
                    <SelectItem value="pdf">Manual Uploads</SelectItem>
                    <SelectItem value="blog">RSS / Blogs</SelectItem>
                    <SelectItem value="xml">XML Batch</SelectItem>
                  </SelectContent>
                </Select>

                <Link href="/all-documents" className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 group transition-all shrink-0 ml-2" data-testid="button-view-all">
                  View all
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-0 border-t border-border/40">
              <table className="w-full text-sm text-left border-collapse table-fixed">
                <thead className="bg-[#fcfdff] backdrop-blur-sm sticky top-0 z-10 border-b border-border text-xs uppercase tracking-wider font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-4 text-center w-12">#</th>
                    <th className="px-4 py-4">File Name</th>
                    <th className="px-4 py-4 w-28">Date</th>
                    <th className="px-4 py-4 w-24">Source</th>
                    <th className="px-4 py-4 w-28">Completed</th>
                    <th className="px-4 py-4 w-20">Time</th>
                    <th className="px-4 py-4 w-32">Status</th>
                    <th className="px-4 py-4 text-center w-20">Topics</th>
                    <th className="px-4 py-4 text-center w-24">Keywords</th>
                    <th className="px-4 py-4 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {displayedItems.map((row, index) => {
                    const actualIndex = isViewAll ? (currentPage - 1) * pageSize + index + 1 : index + 1;
                    return (
                      <tr key={row.id} className="hover:bg-white/60 transition-colors group bg-white/20">
                        <td className="px-4 py-4 text-center text-muted-foreground font-mono text-xs whitespace-nowrap">{actualIndex}</td>
                        <td className="px-4 py-4 truncate">
                          <div className="flex items-center gap-3 w-full min-w-0">
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${row.sourceType === 'pdf' ? 'bg-red-50 text-red-500' : (row.sourceType === 'xml' ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500')}`}>
                              {row.sourceType === 'pdf' ? <FileText className="h-4 w-4 shrink-0" /> : (row.sourceType === 'xml' ? <FileText className="h-4 w-4 shrink-0" /> : <Grid3x3 className="h-4 w-4 shrink-0" />)}
                            </div>
                            <span className="font-medium text-slate-800 truncate block" title={row.displayName}>{row.displayName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">
                          {new Date(row.displayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter ${
                            row.sourceType === 'blog' ? 'bg-amber-100 text-amber-700' : (row.sourceType === 'xml' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700')
                          }`}>
                            {row.sourceType === 'blog' ? 'RSS/BLOG' : (row.sourceType === 'xml' ? 'XML BATCH' : 'UPLOAD')}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">
                          {row.completed_date ? new Date(row.completed_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "--"}
                        </td>
                        <td className="px-4 py-4 text-muted-foreground font-mono text-xs whitespace-nowrap">
                          {row.process_time ? `${row.process_time.toFixed(1)}s` : row.status === 'Completed' ? '0.0s' : "--"}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                              row.status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200'
                            : row.status === 'Scanned PDF' ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : (row.status === 'Failed' || row.status === 'Error') ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {(row.status === 'Processing' || row.status === 'Pending') && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />}
                            {row.status === 'Completed' && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                            {row.status === 'Scanned PDF' && <span className="text-amber-500 text-xs shrink-0">⚠</span>}
                            <span>{row.status}</span>
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center whitespace-nowrap">
                          <span className="inline-flex items-center justify-center h-7 px-3 rounded-md bg-muted font-mono font-medium text-xs">
                            {row.topics_count || (Array.isArray(row.topics_list) ? row.topics_list.length : 0) || "--"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center whitespace-nowrap">
                          <span className="inline-flex items-center justify-center h-7 px-3 rounded-md bg-primary/10 text-primary font-mono font-medium text-xs">
                            {row.keywords_count || (Array.isArray(row.keywords_list) ? row.keywords_list.length : 0) || "--"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center whitespace-nowrap">
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {documents.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-60 pt-16">
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-border/50 mb-4 transform -rotate-3">
                    <File className="h-12 w-12 text-primary/20" strokeWidth={1} />
                  </div>
                  <p className="text-muted-foreground font-medium">Ready for your first document</p>
                </div>
              )}
            </div>

            {/* Footer Controls - Only show pagination when View All is active */}
            {isViewAll && (
              <div className="px-6 py-4 border-t border-border/50 bg-white/50 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-4 text-sm text-muted-foreground font-medium">
                  <div className="bg-white px-3 py-1.5 rounded-lg border border-border shadow-sm flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, documents.length)} of {documents.length}
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
                        <SelectValue placeholder="20" />
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
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}