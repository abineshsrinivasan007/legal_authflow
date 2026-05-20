import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Lock, User, Hexagon, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch('/api/auth/login/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        setLocation("/dashboard");
      } else {
        setError(data.error || "Invalid credentials. Please verify and try again.");
      }
    } catch (err) {
      setError("Cannot reach the server. Make sure Django is running.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-slate-900">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-teal-500/20 blur-[120px]" />
        <div className="absolute top-[60%] -right-[10%] w-[60%] h-[60%] rounded-full bg-purple-500/20 blur-[150px]" />
        <div className="absolute top-[30%] left-[30%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]" />
      </div>

      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:flex-none lg:px-20 xl:px-24 z-10 w-full lg:w-1/2">
        <div className="mx-auto w-full max-w-sm lg:w-[400px]">
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="flex items-center gap-3 mb-8">
              <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2.5 rounded-xl shadow-lg shadow-teal-500/30">
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="28" 
                  height="28" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  className="lucide lucide-hexagon h-7 w-7 text-white" 
                  aria-hidden="true"
                >
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <h1 className="text-3xl font-heading font-bold text-white tracking-tight">
                Legal AI <span className="text-teal-400 font-light">Suite</span>
              </h1>
            </div>

            <div className="glass-panel !bg-white/10 !border-white/10 !backdrop-blur-xl rounded-3xl p-8 shadow-2xl">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-white mb-2">Welcome back</h2>
                <p className="text-slate-300 text-sm">
                  Sign in to access document analysis tools
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-200 text-sm p-3.5 rounded-xl flex items-start gap-2 animate-in shake" data-testid="text-error-message">
                    <ShieldCheck className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="username" className="text-slate-300 text-xs uppercase tracking-wider font-semibold">Username</Label>
                  <div className="relative group">
                    <User className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 group-focus-within:text-teal-400 transition-colors" />
                    <Input
                      id="username"
                      placeholder="Enter 'admin'"
                      className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-teal-500/50 focus-visible:border-teal-500/50 h-11 rounded-xl transition-all"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      data-testid="input-username"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-slate-300 text-xs uppercase tracking-wider font-semibold">Password</Label>
                    <a href="#" className="text-xs text-teal-400 hover:text-teal-300 transition-colors font-medium">Forgot password?</a>
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-400 group-focus-within:text-teal-400 transition-colors" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter 'password'"
                      className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-teal-500/50 focus-visible:border-teal-500/50 h-11 rounded-xl transition-all"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-password"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 bg-teal-500 hover:bg-teal-400 text-white rounded-xl shadow-lg shadow-teal-500/20 font-medium text-base mt-2 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      Secure Login
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </Button>
              </form>
            </div>

            <div className="mt-8 text-center">
              <p className="text-slate-500 text-xs flex items-center justify-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Enterprise-grade security • End-to-end encryption
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side aesthetic panel */}
      <div className="hidden lg:block relative flex-1 z-10 w-full overflow-hidden">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent z-10" />
        <div className="absolute top-[20%] left-[20%] right-[20%] bottom-[20%] border border-white/10 rounded-[40px] bg-white/5 backdrop-blur-3xl p-8 flex flex-col justify-end overflow-hidden shadow-2xl z-20 transform -rotate-2 hover:rotate-0 transition-all duration-700 ease-out">
          <div className="absolute top-0 right-0 p-6 opacity-30">
            <Hexagon className="w-64 h-64 text-teal-500" strokeWidth={0.5} />
          </div>

          <div className="relative z-10 bg-slate-900/60 p-6 rounded-2xl border border-white/10 backdrop-blur-md mb-6 max-w-sm ml-auto animate-in slide-in-from-right-8 duration-1000 delay-300 fill-mode-both">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-white/70 font-mono">PROCESSING_DOCUMENT</span>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-teal-400 w-[65%]" />
              </div>
              <div className="flex justify-between text-[10px] text-white/50">
                <span>Extracting Entities</span>
                <span>65%</span>
              </div>
            </div>
          </div>

          <h3 className="text-4xl font-heading font-light text-white mb-4">
            Transforming documents<br />into <span className="font-semibold text-teal-400">intelligence.</span>
          </h3>
          <p className="text-slate-400 text-lg max-w-lg leading-relaxed">
            Upload legal documents to instantly extract Topics and Keywords with 99.9% accuracy.
          </p>
        </div>
      </div>
    </div>
  );
}