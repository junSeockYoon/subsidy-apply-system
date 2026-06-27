import { Link, Route, Routes } from 'react-router-dom';
import UserPage from './pages/UserPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="logo">
            <span className="logo-badge">정부24</span>
            대국민 금융 지원금
          </Link>
          <nav>
            <Link to="/">신청하기</Link>
            <Link to="/admin">관리자</Link>
          </nav>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<UserPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
      <footer className="footer">포트폴리오 데모 — API/Worker 분리 아키텍처</footer>
    </div>
  );
}
