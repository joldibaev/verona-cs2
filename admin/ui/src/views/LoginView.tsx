import { SteamIcon } from '../components/brand-icons'

export default function LoginView(){
  return <main className="login-page"><section className="login-card"><div className="login-mark">V</div><p className="kicker">VERONA CS2 CONTROL PLANE</p><h1>Сервер под контролем.</h1><p>Войдите через Steam, чтобы управлять сервером и своим игровым loadout.</p><a className="steam-button" href="/api/auth/steam"><SteamIcon size={22}/>Войти через Steam</a><small>Steam OpenID · пароль не передаётся Verona CS2</small></section></main>
}
