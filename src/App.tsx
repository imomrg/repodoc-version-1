import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "./components/ui/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import NotFound from "./pages/not-found";
import { useState } from "react";
import { Terminal, FileText, ArrowRight, Loader2, Copy, Sparkles, AlertCircle, CheckCircle2, Eye, Code2 } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { useToast } from "./hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const queryClient = new QueryClient();

interface DocumentationData {
  repoName: string;
  fileCount: number;
  documentation: string;
}

function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [docTab, setDocTab] = useState<"raw" | "preview">("preview");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [docData, setDocData] = useState<DocumentationData | null>(null);
  const { toast } = useToast();

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);
    setDocData(null);

    try {
      const cleanPath = repoUrl
        .replace('https://github.com/', '')
        .replace('.git', '')
        .trim()
        .split('/');
      
      if (cleanPath.length < 2) {
        throw new Error("Invalid GitHub URL structure. Use format: https://github.com/owner/repo");
      }

      const owner = cleanPath[0];
      const repo = cleanPath[1];

      const githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`);
      
      if (!githubResponse.ok) {
        throw new Error("Failed to read repository structure. Make sure it is public!");
      }

      const repoData = await githubResponse.json();
      
      if (!repoData.tree) {
        throw new Error("Empty repository structure found.");
      }

      const allowedExtensions = ['.tsx', '.ts', '.jsx', '.js', '.json', '.css', '.html'];
      const files = repoData.tree.filter((item: any) => 
        item.type === 'blob' && 
        allowedExtensions.some(ext => item.path.endsWith(ext)) &&
        !item.path.includes('node_modules') &&
        !item.path.includes('package-lock.json')
      );

     // 1. Build headers with your local environment token if it exists
      const requestHeaders: HeadersInit = {};
      if (import.meta.env.VITE_GITHUB_TOKEN) {
        requestHeaders['Authorization'] = `token ${import.meta.env.VITE_GITHUB_TOKEN}`;
      }

      // 2. Fetch the repository structure directly from GitHub
      const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
      let treeRes = await fetch(treeUrl, { headers: requestHeaders });
      
      if (!treeRes.ok) {
        const fallbackTreeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`;
        treeRes = await fetch(fallbackTreeUrl, { headers: requestHeaders });
      }

      if (!treeRes.ok) {
        throw new Error('Failed to fetch repository structure. Verify the repository is public or check your API token.');
      }

      const treeData = await treeRes.json();
      const fetchedTreeFiles = treeData.tree || [];
      let combinedCodePayload = '';

      // 3. Filter for valid files
      const validFiles = fetchedTreeFiles.filter((f: any) => 
        f.type === 'blob' && 
        !f.path.includes('node_modules') && 
        !f.path.includes('.git') &&
        (
          f.path.endsWith('.java') || 
          f.path.endsWith('.js') || 
          f.path.endsWith('.tsx') || 
          f.path.endsWith('.ts') || 
          f.path.endsWith('.html') || 
          f.path.endsWith('.css') || 
          f.path.endsWith('.py') || 
          f.path.endsWith('.md')
        )
      );

      const targetPriorityFiles = validFiles.slice(0, 15);

      // 4. Fetch actual code contents securely using your token
      for (const file of targetPriorityFiles) {
        try {
          const rawFileUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`;
          let contentRes = await fetch(rawFileUrl, { headers: requestHeaders });
          
          if (!contentRes.ok) {
            const fallbackUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/${file.path}`;
            contentRes = await fetch(fallbackUrl, { headers: requestHeaders });
          }

          if (contentRes.ok) {
            const textContent = await contentRes.text();
            combinedCodePayload += `\n\n--- FILE: ${file.path} ---\n${textContent}`;
          }
        } catch (fileErr) {
          console.warn(`Skipped content reading for: ${file.path}`, fileErr);
        }
      }
     // ADD THIS SAFEGUARD LINE RIGHT HERE:
      // Limits the payload to roughly 100k characters to prevent Groq 400 errors
      if (combinedCodePayload.length > 100000) {
        combinedCodePayload = combinedCodePayload.substring(0, 100000) + "\n\n...[Code truncated for size limits]...";
      }

     
     
     
     

      // 2. Loop through and read the actual code contents using jsDelivr CDN to bypass browser CORS blocks
      for (const file of targetPriorityFiles) {
        try {
          const rawFileUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/${file.path}`;
          let contentRes = await fetch(rawFileUrl);
          
          if (!contentRes.ok) {
            const fallbackUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@master/${file.path}`;
            contentRes = await fetch(fallbackUrl);
          }

          if (contentRes.ok) {
            const textContent = await contentRes.text();
            combinedCodePayload += `\n\n--- FILE: ${file.path} ---\n${textContent}`;
          } else {
            console.warn(`Could not read file contents for: ${file.path}`);
          }
        } catch (fileErr) {
          console.warn(`Skipped content reading for: ${file.path}`, fileErr);
        }
      }

      // @ts-ignore
      // Ensure apiKey is completely hardcoded or mapped correctly right here:
      const apiKey = "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";

      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          // Use the correct versatile model ID
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are an expert technical writer. Generate comprehensive markdown documentation based on the provided repository code files."
            },
            {
              role: "user",
              content: `Analyze the following source files and generate detailed technical documentation:\n\n${combinedCodePayload}`
            }
          ],
          temperature: 0.3
        })
      });

      if (!groqResponse.ok) {
        const errorData = await groqResponse.json().catch(() => ({}));
        console.error("Groq API Error Details:", errorData);
        throw new Error(`The Groq API returned an engine connection error: ${groqResponse.status}`);
      }

      const resultData = await groqResponse.json();
      const markdownOutput = resultData.choices[0]?.message?.content;

      if (!markdownOutput) {
        throw new Error("No documentation generation data returned from Groq.");
      }

      setDocData({
        repoName: repo,
        fileCount: files.length,
        documentation: markdownOutput
      });

      toast({
        title: "Documentation generated",
        description: "Successfully analyzed repository layout and file contents.",
      });

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred while analyzing the repository.");
      toast({
        title: "Analysis failed",
        description: "Failed to generate documentation from the repository.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (docData?.documentation) {
      navigator.clipboard.writeText(docData.documentation);
      toast({
        title: "Copied to clipboard",
        description: "Documentation has been copied.",
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-background selection:bg-primary/30">
      <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            <span className="font-mono font-semibold tracking-tight text-foreground">RepoDoc<span className="text-primary">AI</span></span>
          </div>
          <div className="flex items-center gap-2 text-sm font-mono px-3 py-1 rounded-full bg-secondary/50 border border-white/5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-muted-foreground hidden sm:inline-block">Live AI Engine Connected</span>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-16 max-w-4xl flex flex-col gap-12">
        <div className="flex flex-col items-center text-center gap-6 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            <span>AI-Powered Documentation</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground">
            Generate Software Docs <br className="hidden md:block"/> From Code
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Paste a public repository URL and instantly get comprehensive technical documentation, architecture overviews, and file structure analysis.
          </p>

          <form onSubmit={handleGenerate} className="w-full mt-4">
            <div className="relative flex flex-col sm:flex-row items-center gap-3 w-full p-2 bg-secondary/30 rounded-2xl border border-white/5 shadow-2xl focus-within:ring-1 focus-within:ring-primary/50 transition-all duration-300">
              <div className="relative flex-1 w-full">
                <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full pl-12 pr-4 h-14 bg-transparent border-none shadow-none focus-visible:ring-0 text-base font-mono"
                  disabled={isLoading}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto h-14 px-8 rounded-xl font-medium shadow-primary/20 shadow-lg hover:shadow-primary/40 transition-all duration-300"
                disabled={isLoading || !repoUrl.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Reading Code Details...
                  </>
                ) : (
                  <>
                    Generate Docs
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {errorMsg && (
          <Card className="border-destructive/50 bg-destructive/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CardContent className="pt-6 flex gap-4 items-start">
              <AlertCircle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-destructive">Analysis Failed</h3>
                <p className="text-muted-foreground text-sm">{errorMsg}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {docData && !errorMsg && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    {docData.repoName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Deep-Analyzed core source files
                  </p>
                </div>
              </div>
              <Button onClick={handleCopy} variant="secondary" className="gap-2">
                <Copy className="w-4 h-4" />
                Copy to Clipboard
              </Button>
            </div>

            <Card className="border-white/10 bg-secondary/20 backdrop-blur overflow-hidden shadow-2xl">
              <CardHeader className="border-b border-white/5 bg-secondary/40 py-3 px-4 flex flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <CardTitle className="text-sm font-mono font-medium text-muted-foreground">documentation.md</CardTitle>
                </div>
                <div className="flex items-center gap-1 bg-background/40 rounded-lg p-1 border border-white/5">
                  <button
                    onClick={() => setDocTab("raw")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                      docTab === "raw"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Code2 className="w-3 h-3" />
                    Raw
                  </button>
                  <button
                    onClick={() => setDocTab("preview")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                      docTab === "preview"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    Preview
                  </button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {docTab === "raw" ? (
                  <div className="p-6 md:p-8 bg-[#0d1117] overflow-x-auto max-h-[72vh] overflow-y-auto custom-scrollbar">
                    <pre className="font-mono text-sm leading-relaxed text-gray-300 whitespace-pre-wrap">
                      {docData.documentation}
                    </pre>
                  </div>
                ) : (
                  <div className="p-6 md:p-8 bg-[#0d1117] overflow-x-auto max-h-[72vh] overflow-y-auto custom-scrollbar">
                    <div className="prose prose-invert prose-sm md:prose-base max-w-none
                      prose-headings:text-slate-100 prose-headings:font-bold prose-headings:border-b prose-headings:border-white/10 prose-headings:pb-2
                      prose-h1:text-2xl prose-h2:text-xl prose-h2:mt-8 prose-h3:text-base prose-h3:mt-6
                      prose-p:text-slate-300 prose-p:leading-relaxed
                      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                      prose-strong:text-slate-100
                      prose-code:text-violet-300 prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                      prose-pre:bg-[#161b22] prose-pre:border prose-pre:border-white/10 prose-pre:rounded-lg
                      prose-ul:text-slate-300 prose-ol:text-slate-300
                      prose-li:marker:text-primary prose-li:my-0.5
                      prose-blockquote:border-primary/50 prose-blockquote:text-slate-400
                      prose-hr:border-white/10
                      prose-table:text-sm prose-th:text-slate-200 prose-td:text-slate-300 prose-th:border prose-th:border-white/10 prose-td:border prose-td:border-white/10
                    ">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {docData.documentation}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}