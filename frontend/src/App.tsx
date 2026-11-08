import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import LandingView from './components/LandingView';
import HostSetup from './components/HostSetup';
import GameRoute from './components/GameRoute';
import GameSelection from './components/GameSelection';
import JustOneHome from './components/JustOneHome';
import SoundsFishyHome from './components/SoundsFishyHome';
import WavelengthHome from './components/WavelengthHome';
import UnoHome from './components/UnoHome';
const MonopolyDealHome = lazy(() => import('./components/MonopolyDealHome'));
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GameSelection />} />
        <Route path="/top10" element={<LandingView />} />
        <Route path="/just-one" element={<JustOneHome />} />
        <Route path="/sounds-fishy" element={<SoundsFishyHome />} />
        <Route path="/wavelength" element={<WavelengthHome />} />
        <Route path="/uno" element={<UnoHome />} />
        <Route path="/monopoly-deal" element={<Suspense fallback={<main className="page">Opening your table…</main>}><MonopolyDealHome /></Suspense>} />
        <Route path="/g/:gameId/display" element={<GameRoute display />} />
        <Route path="/host" element={<HostSetup />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/g/:gameId" element={<GameRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
