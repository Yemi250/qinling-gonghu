import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router";
import {
  JourneyHome,
  ScenicPage,
  Footprints,
} from "./features/journey/Journey";
import { MemoryPage, CarePage } from "./features/journey/Records";
import { Workbench } from "./features/journey/Workbench";
import { DesignPreview } from "./preview/DesignPreview";

// Hash routes keep deep links working however the build is served.
/** Restore the top of each chapter while keeping private credentials out of links. */
function ChapterRoutes() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <Routes>
      <Route path="/" element={<JourneyHome />} />
      <Route
        path="/scenic/:slug"
        element={<ScenicPage key={location.pathname} />}
      />
      <Route path="/footprints" element={<Footprints />} />
      <Route
        path="/memory/:id"
        element={<MemoryPage key={location.pathname} />}
      />
      <Route path="/care/:id" element={<CarePage key={location.pathname} />} />
      <Route path="/workbench" element={<Workbench />} />
      <Route
        path="/report"
        element={<Navigate to="/scenic/taibai" replace />}
      />
      <Route path="/track" element={<Navigate to="/footprints" replace />} />
      <Route path="/preview" element={<DesignPreview />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
export function App() {
  return (
    <HashRouter>
      <ChapterRoutes />
    </HashRouter>
  );
}
