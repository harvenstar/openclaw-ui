import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ReviewPage from './pages/ReviewPage'
import ApprovalPage from './pages/ApprovalPage'
import HomePage from './pages/HomePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/review/:id" element={<ReviewPage />} />
        <Route path="/approval/:id" element={<ApprovalPage />} />
      </Routes>
    </BrowserRouter>
  )
}
