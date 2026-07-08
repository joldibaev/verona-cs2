import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  SignOut,
  UsersThree,
  GameController,
  PaintBrush,
  Pulse,
} from "@phosphor-icons/react";
import { clearMe, getMe, type Me } from "./api";
import { faceitLevel } from "./faceit";
import { Button } from "./components/ui";
const DashboardView = lazy(() => import("./views/DashboardView"));
const PlayersView = lazy(() => import("./views/PlayersView"));
const SkinchangerView = lazy(() => import("./views/SkinchangerView"));
const LoginView = lazy(() => import("./views/LoginView"));
const DiagnosticsView = lazy(() => import("./views/DiagnosticsView"));

function Shell() {
  const [me, setMe] = useState<Me | null>(null),
    [loaded, setLoaded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void getMe().then((value) => {
      if (active) {
        setMe(value);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [location.pathname]);
  if (!loaded) return <div className="page-loader">VERONA CS2 // CONNECTING</div>;
  if (!me) return <Navigate to="/login" replace />;
  const links = me.isAdmin
    ? ([
        ["/", "Серверы", GameController],
        ["/players", "Игроки", UsersThree],
        ["/skinchanger", "Skinchanger", PaintBrush],
        ["/diagnostics", "Диагностика", Pulse],
      ] as const)
    : ([["/skinchanger", "Skinchanger", PaintBrush]] as const);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearMe();
    navigate("/login");
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="wordmark">
            <b>V</b>
            <span>VERONA CS2</span>
            <i />
          </NavLink>
          <nav>
            {links.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} end={to === "/"}>
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="account">
            {me.faceitElo && (
              <span className="elo-badge">
                <img src={`/faceit/lvl${faceitLevel(me.faceitElo)}.svg`} />
                {me.faceitElo} ELO
              </span>
            )}
            {me.avatarUrl && (
              <img className="avatar" src={me.avatarUrl} alt="" />
            )}
            <span className="account-name">{me.name}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Выйти"
            >
              <SignOut size={18} />
            </Button>
          </div>
        </div>
      </header>
      <div className="network-strip">
        <span>
          <i /> CONTROL PLANE
        </span>
        <b>LOCALHOST</b>
        <span>CS2 DEDICATED SERVER</span>
      </div>
      <main className="content">
        <Routes>
          <Route
            index
            element={
              me.isAdmin ? (
                <DashboardView />
              ) : (
                <Navigate to="/skinchanger" replace />
              )
            }
          />
          <Route
            path="players"
            element={
              me.isAdmin ? (
                <PlayersView />
              ) : (
                <Navigate to="/skinchanger" replace />
              )
            }
          />
          <Route path="skinchanger" element={<SkinchangerView />} />
          <Route path="diagnostics" element={me.isAdmin ? <DiagnosticsView /> : <Navigate to="/skinchanger" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
export default function App() {
  const location = useLocation();
  return (
    <Suspense fallback={<div className="page-loader">VERONA CS2 // LOADING</div>}>
      {location.pathname === "/login" ? <LoginView /> : <Shell />}
    </Suspense>
  );
}
