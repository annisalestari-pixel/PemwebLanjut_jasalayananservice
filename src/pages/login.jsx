import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../style/login.css'

function Login() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = (e) => {
    e.preventDefault()

    if (!email || !password) {
      setError('Email dan password wajib diisi!')
      return
    }

    setError('')
    navigate('/dashboard')
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="left-section">
          <h1>karya Mandiri</h1>
          <p>
            Solusi cepat untuk service elektronik rumah tangga favoritmu.
          </p>
        </div>

        <div className="right-section">
          <h2>Login</h2>

          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Masukkan email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label>Password</label>

              <div className="password-box">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <button
                  type="button"
                  className="show-btn"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="login-btn">
              Login
            </button>
          </form>

          <p className="register-text">
            Belum punya akun? <span>Daftar sekarang</span>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login