import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LandingView from './components/LandingView';
import HostSetup from './components/HostSetup';
import GameShell from './components/GameShell';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingView />} />
        <Route path="/host" element={<HostSetup />} />
        <Route path="/g/:gameId" element={<GameShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
