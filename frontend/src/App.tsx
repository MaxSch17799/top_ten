import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Suspense } from 'react';
import { GAME_TYPES } from '../../shared/games';
import { gameComponents } from './app/games';
import HostSetup from './components/HostSetup';
import GameRoute from './components/GameRoute';
import GameSelection from './components/GameSelection';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GameSelection />} />
        {GAME_TYPES.map(id => {
          const game = gameComponents[id];
          const Home = game.Home;
          return <Route key={id} path={game.path} element={<Suspense fallback={<main className="page">{game.loading}</main>}><Home /></Suspense>} />;
        })}
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
