import { useState, useMemo, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Search,
  BookOpen,
  Eye,
  List
} from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DocumentData {
  id: number;
  name: string;
  topics_list?: string[];
  status: string;
}

interface TopicEntry {
  topic: string;
  files: { id: string | number; name: string }[];
}

export default function StatusView() {
  const [dbTopics, setDbTopics] = useState<TopicEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Dialog State
  const [selectedTopic, setSelectedTopic] = useState<TopicEntry | null>(null);
  const [detailCurrentPage, setDetailCurrentPage] = useState(1);
  const detailPageSize = 5;

  const handleOpenDetail = (topic: TopicEntry) => {
    setSelectedTopic(topic);
    setDetailCurrentPage(1);
  };

  const fetchTopics = async () => {
    try {
      const res = await fetch("/api/topics/");
      if (res.ok) {
        const data = await res.json();
        setDbTopics(data);
      }
    } catch (e) {
      console.error("Failed to fetch topics", e);
    }
  };

  useEffect(() => {
    fetchTopics();
    const interval = setInterval(fetchTopics, 3000);
    return () => clearInterval(interval);
  }, []);

  const dictionary = useMemo(() => {
    let entries = [...dbTopics];

    // Filter by unique / shared frequency
    if (filterType === "unique") {
      entries = entries.filter(e => e.files.length === 1);
    } else if (filterType === "shared") {
      entries = entries.filter(e => e.files.length > 1);
    }

    // Filter by search query (matches topic name or file name)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return entries.filter(e =>
        e.topic.toLowerCase().includes(q) ||
        e.files.some(f => f.name.toLowerCase().includes(q))
      );
    }
    return entries;
  }, [dbTopics, searchQuery, filterType]);

  const totalPages = Math.ceil(dictionary.length / pageSize) || 1;

  const displayedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return dictionary.slice(startIndex, startIndex + pageSize);
  }, [dictionary, currentPage, pageSize]);

  return (
    <Layout>
      <div className="h-full flex flex-col max-w-[1400px] mx-auto">

        <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0 mt-2">
          <div>
            <h1 className="text-3xl font-heading font-semibold text-foreground tracking-tight mb-2">
              Topic Dictionary
            </h1>
            <p className="text-muted-foreground text-sm">
              Explore all unique topics extracted across your entire document library.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search topics or files..."
                className="h-10 w-full sm:w-[280px] pl-8 text-sm bg-white border-white/60 shadow-sm transition-all focus:w-full focus:sm:w-[320px]"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <Select
              value={filterType}
              onValueChange={(val) => { setFilterType(val); setCurrentPage(1); }}
            >
              <SelectTrigger className="h-10 w-full sm:w-[160px] bg-white border-white/60 shadow-sm text-sm">
                <SelectValue placeholder="All Topics" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Topics</SelectItem>
                <SelectItem value="unique">Only Unique Topics</SelectItem>
                <SelectItem value="shared">Shared Topics</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="glass-card rounded-2xl flex-1 flex flex-col min-h-0 shadow-sm border border-white">
          <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between bg-white/50 shrink-0">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 p-1.5 rounded-lg">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              <h2 className="font-semibold text-foreground">
                Global Extracted Topics
              </h2>
            </div>
            <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded-lg border border-border shadow-sm">
              Total {filterType === "unique" ? "Unique " : filterType === "shared" ? "Shared " : ""}Topics: <span className="text-primary font-bold ml-1">{dictionary.length}</span>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-0">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-[hsl(var(--table-header))]/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 w-16 text-center whitespace-nowrap">#</th>
                  <th className="px-6 py-4 min-w-[250px] whitespace-nowrap">Topic Name</th>
                  <th className="px-6 py-4 w-32 text-center whitespace-nowrap">Files Count</th>
                  <th className="px-6 py-4 w-28 text-center whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {displayedItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                      {searchQuery ? "No topics matched your search." : "No topics found. Please upload and process documents first."}
                    </td>
                  </tr>
                ) : (
                  displayedItems.map((entry, index) => {
                    const actualIndex = (currentPage - 1) * pageSize + index + 1;
                    return (
                      <tr key={entry.topic} className="hover:bg-white/60 transition-colors group bg-white/20">
                        <td className="px-6 py-5 text-center text-muted-foreground font-mono text-xs whitespace-nowrap align-middle">{actualIndex}</td>
                        <td className="px-6 py-5 font-medium text-foreground align-middle">
                          {entry.topic}
                        </td>
                        <td className="px-6 py-5 align-middle text-center">
                          <span className="inline-flex items-center justify-center font-mono font-medium text-sm text-primary bg-primary/10 px-3 py-1 rounded-lg">
                            {entry.files.length}
                          </span>
                        </td>
                        <td className="px-6 py-5 align-middle text-center">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 gap-2 text-primary hover:text-primary hover:bg-primary/5"
                            onClick={() => handleOpenDetail(entry)}
                          >
                            <List className="h-3.5 w-3.5" />
                            Details
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Controls */}
          <div className="px-6 py-4 border-t border-border/50 bg-white/50 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-4 text-sm text-muted-foreground font-medium">
              <div className="bg-white px-3 py-1.5 rounded-lg border border-border shadow-sm flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary" />
                Showing {(currentPage - 1) * pageSize + (displayedItems.length > 0 ? 1 : 0)} to {Math.min(currentPage * pageSize, dictionary.length)} of {dictionary.length} topics
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
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg bg-white shadow-sm"
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={() => setCurrentPage(totalPages)}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!selectedTopic} onOpenChange={(open) => !open && setSelectedTopic(null)}>
        <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-border/50 bg-white/95 backdrop-blur-xl">
          {selectedTopic && (
            <>
              <div className="p-6">
                <DialogHeader className="mb-6">
                  <DialogTitle className="text-xl font-heading text-primary flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Topic Name: {selectedTopic.topic}
                  </DialogTitle>
                  <DialogDescription>
                    This topic appears in {selectedTopic.files.length} document{selectedTopic.files.length !== 1 ? 's' : ''}.
                  </DialogDescription>
                </DialogHeader>

                <div className="border border-border/50 rounded-lg overflow-hidden relative shadow-sm">
                  <table className="w-full text-sm text-left border-collapse bg-white">
                    <thead className="bg-muted/50 border-b border-border/50 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 w-16 text-center whitespace-nowrap">#</th>
                        <th className="px-4 py-3 min-w-[200px]">File Name (PDF)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {(() => {
                        const startIndex = (detailCurrentPage - 1) * detailPageSize;
                        const displayedFiles = selectedTopic.files.slice(startIndex, startIndex + detailPageSize);
                        return displayedFiles.map((file, i) => (
                          <tr key={file.id} className="hover:bg-primary/5 transition-colors">
                            <td className="px-4 py-3 text-center text-muted-foreground font-mono text-xs whitespace-nowrap align-middle">
                              {startIndex + i + 1}
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground align-middle">
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-primary opacity-70" />
                                {file.name}
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {/* Dialog Pagination */}
              {selectedTopic.files.length > detailPageSize && (
                <div className="px-6 py-4 bg-muted/30 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground font-medium">
                    Showing {(detailCurrentPage - 1) * detailPageSize + 1} to {Math.min(detailCurrentPage * detailPageSize, selectedTopic.files.length)} of {selectedTopic.files.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 bg-white"
                      disabled={detailCurrentPage === 1}
                      onClick={() => setDetailCurrentPage(prev => Math.max(1, prev - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium px-3">Page {detailCurrentPage}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 bg-white"
                      disabled={detailCurrentPage === Math.ceil(selectedTopic.files.length / detailPageSize)}
                      onClick={() => setDetailCurrentPage(prev => Math.min(Math.ceil(selectedTopic.files.length / detailPageSize), prev + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}