import { BrowserRouter, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Incidents from "./pages/Incidents";
import IncidentPage from "./pages/IncidentPage";
import Sources from "./pages/Sources";
import Events from "./pages/Events";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 p-6">
          <Routes>
            <Route path="/" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentPage />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/events" element={<Events />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
