import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ReviewPage from './pages/ReviewPage'
import ApprovalPage from './pages/ApprovalPage'
import CodeReviewPage from './pages/CodeReviewPage'
import HomePage from './pages/HomePage'
import FormReviewPage from './pages/FormReviewPage'
import SelectionPage from './pages/SelectionPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/review/:id" element={<ReviewPage />} />
        <Route path="/approval/:id" element={<ApprovalPage />} />
        <Route path="/code-review/:id" element={<CodeReviewPage />} />
        <Route path="/form-review/:id" element={<FormReviewPage />} />
        <Route path="/selection/:id" element={<SelectionPage />} />
      </Routes>
    </BrowserRouter>
  )
}
