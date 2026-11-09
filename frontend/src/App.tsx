import { BrowserRouter, Route, Routes } from "react-router-dom";
import ConnectionBanner from "./components/ConnectionBanner";
import Sidebar from "./components/Sidebar";
import { useBackendReady } from "./hooks/useBackendReady";
import Incidents from "./pages/Incidents";
import IncidentPage from "./pages/IncidentPage";
import NotFound from "./pages/NotFound";
import Sources from "./pages/Sources";
import Events from "./pages/Events";

export default function App() {
  const backend = useBackendReady();
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 p-6">
          <ConnectionBanner status={backend} />
          <Routes>
            <Route path="/" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentPage />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/events" element={<Events />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
