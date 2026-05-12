import { Routes, Route } from 'react-router-dom'
import Login from './pages/login'

function Dashboard() {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: '2rem',
        fontWeight: 'bold',
      }}
    >
      Dashboard Service Elektronik 🔧
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  )
}

export default App