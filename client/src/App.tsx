import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/home";
import YearwisePage from "@/pages/yearwise";
import YearwiseSessionPage from "@/pages/yearwise-session";
import WeekPage from "@/pages/week";
import ReviewPage from "@/pages/review";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/week/:weekStart" component={WeekPage} />
      <Route path="/review/:weekStart" component={ReviewPage} />
      <Route path="/yearwise" component={YearwisePage} />
      <Route path="/yearwise/:sessionId" component={YearwiseSessionPage} />
      <Route path="/yearwise/:sessionId/:step" component={YearwiseSessionPage} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
