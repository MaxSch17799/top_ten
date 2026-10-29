import { useNavigate } from 'react-router-dom';

export default function SessionNavigation({
  active = false,
}: {
  active?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <nav className="session-nav" aria-label="Game navigation">
      <button
        className="ghost"
        onClick={() => {
          if (
            !active ||
            window.confirm(
              'Leave this session? Your seat is saved and you can reconnect using the same link.',
            )
          )
            navigate('/');
        }}
      >
        ← All games
      </button>
    </nav>
  );
}
