import { HashRouter, Navigate, Route, Routes } from "react-router";
import { OverviewPage } from "./features/overview/OverviewPage";
import { DesignPreview } from "./preview/DesignPreview";

// Hash routes keep deep links working however the build is served.
// A owns visitor/overview routes; B adds admin routes below.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/preview" element={<DesignPreview />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
